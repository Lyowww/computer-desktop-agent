import { EventEmitter } from "events";
import os from "os";
import { AgentWebSocketClient, ConnectionState } from "../websocket/WebSocketClient";
import { buildMessage, StatusPayload } from "../websocket/protocol";
import { ActionExecutor } from "./ActionExecutor";
import { DeviceProvisioning } from "../security/DeviceIdentity";
import { PermissionManager } from "../permissions/PermissionManager";
import { LockScreenDetector } from "../security/LockScreenDetector";
import { ConfigService, configService } from "../config/Config";
import { ServerMessageSchema } from "../utils/validation";
import { rootLogger } from "../utils/logger";
import { ZodError } from "zod";

const log = rootLogger.child("Agent");
const APP_VERSION = "1.0.0";

export type AgentUiState = {
  connectionState: ConnectionState;
  online: boolean;
  paused: boolean;
  paired: boolean;
  deviceId: string;
  pairingCode: string;
  locked: boolean;
};

export class Agent extends EventEmitter {
  private readonly ws: AgentWebSocketClient;
  private readonly executor: ActionExecutor;
  private readonly device: DeviceProvisioning;
  private readonly permissions: PermissionManager;
  private readonly lockScreen: LockScreenDetector;
  private readonly config: ConfigService;
  private statusTimer: NodeJS.Timeout | null = null;
  private identityReady = false;
  private deviceId = "";
  private pairingCode = "";
  private paused = false;

  constructor(deps?: {
    ws?: AgentWebSocketClient;
    executor?: ActionExecutor;
    device?: DeviceProvisioning;
    permissions?: PermissionManager;
    lockScreen?: LockScreenDetector;
    config?: ConfigService;
  }) {
    super();
    this.config = deps?.config ?? configService;
    const cfg = this.config.get();
    this.ws =
      deps?.ws ??
      new AgentWebSocketClient({
        baseMs: cfg.reconnectBaseMs,
        maxMs: cfg.reconnectMaxMs,
      });
    this.executor = deps?.executor ?? new ActionExecutor();
    this.device = deps?.device ?? new DeviceProvisioning();
    this.permissions = deps?.permissions ?? new PermissionManager();
    this.lockScreen = deps?.lockScreen ?? new LockScreenDetector();
    this.paused = cfg.paused;

    this.ws.on("open", () => void this.onConnected());
    this.ws.on("message", (data) => void this.onMessage(data));
    this.ws.on("state", (state) => this.emitUi());
    this.ws.on("close", () => this.emitUi());
  }

  async start(): Promise<void> {
    const identity = await this.device.ensureIdentity();
    this.deviceId = identity.deviceId;
    this.pairingCode = identity.pairingCode;
    this.identityReady = true;
    this.emitUi();

    const cfg = this.config.get();
    if (cfg.autoConnect) {
      this.connect();
    }

    this.statusTimer = setInterval(() => void this.publishStatus(), 30_000);
  }

  async stop(): Promise<void> {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    this.ws.disconnect();
    await this.publishStatus(false);
  }

  connect(): void {
    const { backendUrl } = this.config.get();
    this.ws.connect(backendUrl);
  }

  reconnect(): void {
    this.ws.disconnect();
    this.connect();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.config.set("paused", paused);
    void this.publishStatus();
    this.emitUi();
    log.info(paused ? "Agent paused" : "Agent resumed");
  }

  isPaused(): boolean {
    return this.paused;
  }

  async getUiState(): Promise<AgentUiState> {
    const locked = await this.lockScreen.isLocked();
    return {
      connectionState: this.ws.getConnectionState(),
      online: this.ws.isConnected(),
      paused: this.paused,
      paired: this.device.isPaired(),
      deviceId: this.deviceId,
      pairingCode: this.pairingCode,
      locked,
    };
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  getPairingCode(): string {
    return this.pairingCode || this.device.getPairingCode();
  }

  refreshPairingCode(): string {
    this.pairingCode = this.device.refreshPairingCode();
    this.emitUi();
    return this.pairingCode;
  }

  async takeLocalScreenshot(): Promise<{ width: number; height: number; imageBase64: string }> {
    const result = await this.executor.captureScreen(`local_${Date.now()}`, 1280);
    if ("status" in result && result.status === "LOCKED") {
      throw new Error("Computer is locked");
    }
    if ("imageBase64" in result) {
      return {
        width: result.width,
        height: result.height,
        imageBase64: result.imageBase64,
      };
    }
    throw new Error("Screenshot failed");
  }

  private async onConnected(): Promise<void> {
    if (!this.identityReady) return;
    await this.authenticate();
    await this.publishStatus(true);
    this.emitUi();
  }

  private async authenticate(): Promise<void> {
    const cfg = this.config.get();
    const auth = await this.device.getAuthMaterial();
    const nonce = `n_${Date.now()}`;
    const proof = this.device.createAuthProof(nonce, auth.deviceSecret);

    if (!this.device.isPaired()) {
      this.ws.send(
        buildMessage("PAIR", {
          deviceId: auth.deviceId,
          deviceName: cfg.deviceName,
          pairingCode: this.getPairingCode(),
          proof,
          nonce,
          platform: os.platform(),
          version: APP_VERSION,
        })
      );
      log.info("Sent pairing request", { deviceId: auth.deviceId });
      return;
    }

    this.ws.send(
      buildMessage("AUTH", {
        deviceId: auth.deviceId,
        deviceName: cfg.deviceName,
        deviceToken: auth.deviceToken ?? undefined,
        proof,
        nonce,
        platform: os.platform(),
        version: APP_VERSION,
      })
    );
    log.info("Sent auth request", { deviceId: auth.deviceId });
  }

  private async onMessage(raw: unknown): Promise<void> {
    let message;
    try {
      message = ServerMessageSchema.parse(raw);
    } catch (error) {
      const details =
        error instanceof ZodError ? error.errors.map((e) => e.message).join("; ") : String(error);
      log.warn("Rejected invalid server message", { details });
      this.ws.send(
        buildMessage("ERROR", {
          message: `Invalid message: ${details}`,
        })
      );
      return;
    }

    switch (message.event) {
      case "AUTH_RESULT":
      case "PAIR_RESULT": {
        if (message.payload.success && message.payload.deviceToken) {
          await this.device.markPaired(message.payload.deviceToken);
          this.pairingCode = "------";
          this.emitUi();
          log.info("Authentication/pairing succeeded");
        } else {
          log.warn("Authentication/pairing failed", { message: message.payload.message });
        }
        break;
      }
      case "EXECUTE_ACTION": {
        const result = await this.executor.execute(message.payload, { paused: this.paused });
        this.ws.send(buildMessage("ACTION_RESULT", result));
        break;
      }
      case "CAPTURE_SCREEN": {
        if (this.paused) {
          this.ws.send(
            buildMessage("ACTION_RESULT", {
              actionId: message.payload.requestId,
              success: false,
              status: "PAUSED",
              message: "Agent is paused",
            })
          );
          break;
        }
        try {
          const result = await this.executor.captureScreen(
            message.payload.requestId,
            message.payload.maxWidth,
            message.payload.quality
          );
          if ("imageBase64" in result) {
            this.ws.send(buildMessage("SCREEN_RESULT", result));
          } else {
            this.ws.send(buildMessage("ACTION_RESULT", result));
          }
        } catch (error) {
          this.ws.send(
            buildMessage("ACTION_RESULT", {
              actionId: message.payload.requestId,
              success: false,
              status: "ERROR",
              message: error instanceof Error ? error.message : String(error),
            })
          );
        }
        break;
      }
      case "PING": {
        this.ws.send(buildMessage("PONG", { ts: Date.now() }));
        break;
      }
      case "PAUSE": {
        this.setPaused(true);
        break;
      }
      case "RESUME": {
        this.setPaused(false);
        break;
      }
      default:
        break;
    }
  }

  private async publishStatus(online = this.ws.isConnected()): Promise<void> {
    if (!this.deviceId) return;
    const perms = await this.permissions.getStatus();
    const locked = await this.lockScreen.isLocked();
    const payload: StatusPayload = {
      online,
      connected: this.ws.isConnected(),
      paused: this.paused,
      locked,
      deviceId: this.deviceId,
      paired: this.device.isPaired(),
      permissions: {
        accessibility: perms.accessibility,
        screenRecording: perms.screenRecording,
      },
    };
    if (this.ws.isConnected()) {
      this.ws.send(buildMessage("STATUS", payload));
    }
    this.emit("status", payload);
  }

  private emitUi(): void {
    void this.getUiState().then((state) => this.emit("ui", state));
  }
}
