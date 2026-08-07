import { EventEmitter } from "events";
import os from "os";
import { AgentWebSocketClient, ConnectionState } from "../websocket/WebSocketClient";
import type { StatusPayload } from "../websocket/protocol";
import { ActionExecutor } from "./ActionExecutor";
import { DeviceProvisioning } from "../security/DeviceIdentity";
import { PermissionManager } from "../permissions/PermissionManager";
import { LockScreenDetector } from "../security/LockScreenDetector";
import { NotifyService } from "../automation/system/NotifyService";
import { SystemInfoService } from "../automation/system/SystemInfoService";
import { ConfigService, configService } from "../config/Config";
import { ServerMessageSchema, normalizeIncomingMessage } from "../utils/validation";
import { rootLogger } from "../utils/logger";
import { ZodError } from "zod";

const log = rootLogger.child("Agent");

function platformOs(): "darwin" | "win32" | "linux" {
  const p = os.platform();
  if (p === "darwin" || p === "win32" || p === "linux") return p;
  return "linux";
}

export type AgentUiState = {
  connectionState: ConnectionState;
  online: boolean;
  paused: boolean;
  paired: boolean;
  deviceId: string;
  pairingCode: string;
  locked: boolean;
  hasDeviceToken: boolean;
};

export class Agent extends EventEmitter {
  private readonly ws: AgentWebSocketClient;
  private readonly executor: ActionExecutor;
  private readonly device: DeviceProvisioning;
  private readonly permissions: PermissionManager;
  private readonly lockScreen: LockScreenDetector;
  private readonly notify: NotifyService;
  private readonly systemInfo: SystemInfoService;
  private readonly config: ConfigService;
  private statusTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private identityReady = false;
  private deviceId = "";
  private pairingCode = "";
  private paused = false;
  private registered = false;
  private hasDeviceToken = false;
  private recentKeys = new Map<string, number>();

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
    this.notify = new NotifyService();
    this.systemInfo = new SystemInfoService();
    this.paused = cfg.paused;

    this.ws.on("open", () => void this.onConnected());
    this.ws.on("message", (data) => void this.onMessage(data));
    this.ws.on("state", () => this.emitUi());
    this.ws.on("close", () => {
      this.registered = false;
      this.emitUi();
    });
  }

  async start(): Promise<void> {
    const identity = await this.device.ensureIdentity();
    this.deviceId = identity.deviceId;
    this.pairingCode = identity.pairingCode;
    this.identityReady = true;

    const envToken = process.env.AGENT_DEVICE_TOKEN?.trim();
    if (envToken && envToken.length >= 16) {
      await this.device.setDeviceToken(envToken);
      log.info("Loaded AGENT_DEVICE_TOKEN from environment");
    }

    this.hasDeviceToken = Boolean(await this.device.getDeviceToken());
    this.emitUi();

    const cfg = this.config.get();
    if (cfg.autoConnect) {
      this.connect();
    }

    this.statusTimer = setInterval(() => void this.publishStatus(), 30_000);
    this.pingTimer = setInterval(() => {
      if (this.ws.isConnected() && this.registered) {
        this.ws.emitEvent("PING", { requestId: `ping_${Date.now()}` });
      }
    }, 25_000);
  }

  async stop(): Promise<void> {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.ws.disconnect();
  }

  connect(): void {
    const { backendUrl } = this.config.get();
    this.ws.connect(backendUrl);
  }

  reconnect(): void {
    this.registered = false;
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
    this.hasDeviceToken = Boolean(await this.device.getDeviceToken());
    return {
      connectionState: this.ws.getConnectionState(),
      online: this.ws.isConnected() && this.registered,
      paused: this.paused,
      paired: this.device.isPaired() || this.hasDeviceToken,
      deviceId: this.deviceId,
      pairingCode: this.pairingCode,
      locked,
      hasDeviceToken: this.hasDeviceToken,
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

  async setDeviceToken(token: string): Promise<void> {
    await this.device.setDeviceToken(token.trim());
    this.hasDeviceToken = true;
    this.emitUi();
    this.reconnect();
  }

  async takeLocalScreenshot(): Promise<{ width: number; height: number; imageBase64: string }> {
    const result = await this.executor.captureScreen(`local_${Date.now()}`, { maxWidth: 1280 });
    if ("error" in result && result.status === "LOCKED") {
      throw new Error("Computer is locked");
    }
    if ("image" in result) {
      return {
        width: result.width,
        height: result.height,
        imageBase64: result.image,
      };
    }
    throw new Error(result.error ?? "Screenshot failed");
  }

  private async onConnected(): Promise<void> {
    if (!this.identityReady) return;
    await this.registerDevice();
    this.emitUi();
  }

  private async registerDevice(): Promise<void> {
    const cfg = this.config.get();
    const token = await this.device.getDeviceToken();
    if (!token) {
      log.warn("No device token configured — paste the token from the web dashboard (Devices → Add device)");
      this.emitUi();
      return;
    }

    const ok = this.ws.emitEvent("REGISTER_DEVICE", {
      deviceToken: token,
      deviceName: cfg.deviceName,
      os: platformOs(),
    });

    if (ok) {
      log.info("Sent REGISTER_DEVICE");
    }
  }

  private isDuplicate(key: string): boolean {
    const now = Date.now();
    for (const [k, ts] of this.recentKeys) {
      if (now - ts > 2500) this.recentKeys.delete(k);
    }
    if (this.recentKeys.has(key)) return true;
    this.recentKeys.set(key, now);
    return false;
  }

  private async onMessage(raw: unknown): Promise<void> {
    const normalized = normalizeIncomingMessage(raw);
    if (normalized.kind === "ignore") {
      return;
    }

    let message;
    try {
      message = ServerMessageSchema.parse(normalized.message);
    } catch (error) {
      const details =
        error instanceof ZodError ? error.errors.map((e) => e.message).join("; ") : String(error);
      log.warn("Rejected invalid server message", { details });
      // Do not emit ERROR back for protocol noise — it can loop with Nest null echoes.
      return;
    }

    switch (message.event) {
      case "DEVICE_REGISTERED": {
        if (!message.payload) return;
        this.registered = true;
        this.deviceId = message.payload.deviceId;
        await this.device.markPairedWithBackendId(message.payload.deviceId);
        log.info("Device registered with backend", { deviceId: this.deviceId });
        this.emitUi();
        break;
      }
      case "EXECUTE_ACTION": {
        if (this.isDuplicate(`action:${message.payload.actionId}`)) return;
        const result = await this.executor.execute(message.payload, { paused: this.paused });
        this.ws.emitEvent("ACTION_RESULT", {
          actionId: result.actionId,
          taskId: result.taskId,
          success: result.success,
          result: result.result,
          error: result.error,
        });
        break;
      }
      case "CAPTURE_SCREEN": {
        if (this.isDuplicate(`screen:${message.payload.requestId}`)) return;
        if (this.paused) {
          this.ws.emitEvent("ACTION_RESULT", {
            actionId: message.payload.requestId,
            taskId: message.payload.taskId ?? message.payload.requestId,
            success: false,
            error: "Agent is paused",
          });
          break;
        }
        try {
          const result = await this.executor.captureScreen(message.payload.requestId, {
            maxWidth: message.payload.maxWidth,
            quality: message.payload.quality,
            taskId: message.payload.taskId,
          });
          if ("image" in result) {
            this.ws.emitEvent("SCREEN_RESULT", result);
          } else {
            this.ws.emitEvent("ACTION_RESULT", {
              actionId: result.actionId,
              taskId: result.taskId,
              success: false,
              error: result.error,
            });
          }
        } catch (error) {
          this.ws.emitEvent("ACTION_RESULT", {
            actionId: message.payload.requestId,
            taskId: message.payload.taskId ?? message.payload.requestId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }
      case "NOTIFY": {
        if (this.isDuplicate(`notify:${message.payload.requestId}`)) return;
        try {
          const delivered = await this.notify.show(message.payload);
          this.ws.emitEvent("NOTIFY_RESULT", {
            requestId: message.payload.requestId,
            success: true,
            ...delivered,
          });
        } catch (error) {
          this.ws.emitEvent("NOTIFY_RESULT", {
            requestId: message.payload.requestId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }
      case "LIST_PROCESSES": {
        if (this.isDuplicate(`procs:${message.payload.requestId}`)) return;
        try {
          const processes = await this.systemInfo.listProcesses(message.payload.limit ?? 40);
          this.ws.emitEvent("PROCESSES_RESULT", {
            requestId: message.payload.requestId,
            processes,
          });
        } catch (error) {
          this.ws.emitEvent("PROCESSES_RESULT", {
            requestId: message.payload.requestId,
            processes: [],
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }
      case "LIST_APPS": {
        if (this.isDuplicate(`apps:${message.payload.requestId}`)) return;
        try {
          const apps = await this.systemInfo.listRunningApps(message.payload.limit ?? 40);
          this.ws.emitEvent("APPS_RESULT", {
            requestId: message.payload.requestId,
            apps,
          });
        } catch (error) {
          this.ws.emitEvent("APPS_RESULT", {
            requestId: message.payload.requestId,
            apps: [],
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }
      case "PING": {
        this.ws.emitEvent("PONG", {
          requestId: message.payload?.requestId,
          serverTime: Date.now(),
        });
        break;
      }
      case "ERROR": {
        if (!message.payload) return;
        log.warn("Backend ERROR event", {
          code: message.payload.code,
          message: message.payload.message,
        });
        if (message.payload.code === "DEVICE_AUTH_FAILED" || message.payload.code === "AUTH_TIMEOUT") {
          this.registered = false;
        }
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

  private async publishStatus(): Promise<void> {
    if (!this.deviceId) return;
    const perms = await this.permissions.getStatus();
    const locked = await this.lockScreen.isLocked();
    const payload: StatusPayload = {
      online: this.ws.isConnected() && this.registered,
      connected: this.ws.isConnected(),
      paused: this.paused,
      locked,
      deviceId: this.deviceId,
      paired: this.device.isPaired() || this.hasDeviceToken,
      permissions: {
        accessibility: perms.accessibility,
        screenRecording: perms.screenRecording,
      },
    };
    this.emit("status", payload);
  }

  private emitUi(): void {
    void this.getUiState().then((state) => this.emit("ui", state));
  }
}
