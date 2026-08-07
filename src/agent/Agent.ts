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
import { ApplicationService } from "../automation/applications/ApplicationService";
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
  deviceName: string;
  pairingCode: string;
  locked: boolean;
  hasDeviceToken: boolean;
  backendUrl: string;
};

export class Agent extends EventEmitter {
  private readonly ws: AgentWebSocketClient;
  private readonly executor: ActionExecutor;
  private readonly device: DeviceProvisioning;
  private readonly permissions: PermissionManager;
  private readonly lockScreen: LockScreenDetector;
  private readonly notify: NotifyService;
  private readonly systemInfo: SystemInfoService;
  private readonly apps: ApplicationService;
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
    this.apps = new ApplicationService();
    this.paused = cfg.paused;

    this.ws.on("open", () => void this.onConnected());
    this.ws.on("message", (data) => void this.onMessage(data));
    this.ws.on("state", () => this.emitUi());
    this.ws.on("connectionError", (error: Error) => {
      log.warn("Backend unreachable; will keep retrying", {
        error: error?.message || String(error),
      });
      this.emitUi();
    });
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
    // Packaged installs have no .env — wait for Setup credentials before connecting.
    if (cfg.autoConnect && this.hasDeviceToken) {
      this.connect();
    } else if (!this.hasDeviceToken) {
      log.info("Waiting for device token (Setup / Settings) before connecting");
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
    const cfg = this.config.get();
    return {
      connectionState: this.ws.getConnectionState(),
      online: this.ws.isConnected() && this.registered,
      paused: this.paused,
      paired: this.device.isPaired() || this.hasDeviceToken,
      deviceId: this.deviceId,
      deviceName: cfg.deviceName,
      pairingCode: this.pairingCode,
      locked,
      hasDeviceToken: this.hasDeviceToken,
      backendUrl: cfg.backendUrl,
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

  /**
   * Manual setup for packaged DMG installs: typed device name + dashboard token.
   */
  async setupCredentials(input: { deviceName: string; deviceToken: string }): Promise<void> {
    const deviceName = input.deviceName.trim();
    const deviceToken = input.deviceToken.trim();
    if (!deviceName) {
      throw new Error("Device name is required");
    }
    if (deviceToken.length < 16) {
      throw new Error("Device token looks too short. Paste the full token from the dashboard.");
    }
    this.config.set("deviceName", deviceName);
    await this.device.setDeviceToken(deviceToken);
    this.hasDeviceToken = true;
    log.info("Saved device credentials from setup form", { deviceName });
    this.emitUi();
    this.reconnect();
  }

  async takeLocalScreenshot(): Promise<{ width: number; height: number; imageBase64: string }> {
    const result = await this.executor.captureScreen(`local_${Date.now()}`, { maxWidth: 1280 });
    if ("success" in result) {
      if (result.status === "LOCKED") {
        throw new Error("Computer is locked");
      }
      throw new Error(result.error ?? "Screenshot failed");
    }
    if (!result.image || result.width == null || result.height == null) {
      throw new Error(result.error ?? "Screenshot failed");
    }
    return {
      width: result.width,
      height: result.height,
      imageBase64: result.image,
    };
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
    const rawEvent =
      raw && typeof raw === "object" && "event" in raw
        ? String((raw as { event: unknown }).event)
        : undefined;

    const normalized = normalizeIncomingMessage(raw);
    if (normalized.kind === "ignore") {
      // Surface dropped command echoes — these are why web NOTIFY times out if the
      // real payload never arrives (backend/Nest null emit).
      if (
        rawEvent === "NOTIFY" ||
        rawEvent === "CAPTURE_SCREEN" ||
        rawEvent === "EXECUTE_ACTION" ||
        rawEvent === "LIST_PROCESSES" ||
        rawEvent === "LIST_APPS" ||
        rawEvent === "OPEN_APP" ||
        rawEvent === "CLOSE_APP"
      ) {
        log.warn("Dropped inbound command (no usable payload)", {
          event: rawEvent,
          reason: normalized.reason,
        });
      }
      return;
    }

    let message;
    try {
      message = ServerMessageSchema.parse(normalized.message);
    } catch (error) {
      const details =
        error instanceof ZodError ? error.errors.map((e) => e.message).join("; ") : String(error);
      const preview =
        normalized.message && typeof normalized.message === "object"
          ? {
              event: (normalized.message as { event?: string }).event,
              payloadType: typeof (normalized.message as { payload?: unknown }).payload,
              payloadIsNull: (normalized.message as { payload?: unknown }).payload === null,
            }
          : { rawType: typeof normalized.message };
      log.warn("Rejected invalid server message", { details, ...preview });
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
        if (this.isDuplicate(`screen:${message.payload.requestId}`)) {
          log.info("Ignoring duplicate CAPTURE_SCREEN", {
            requestId: message.payload.requestId,
          });
          return;
        }
        log.info("Received CAPTURE_SCREEN", {
          requestId: message.payload.requestId,
          maxWidth: message.payload.maxWidth ?? 1280,
          taskId: message.payload.taskId,
        });
        const emitScreenError = (error: string) => {
          log.warn("Screenshot failed; sending SCREEN_RESULT error", {
            requestId: message.payload.requestId,
            error,
          });
          this.ws.emitEvent("SCREEN_RESULT", {
            requestId: message.payload.requestId,
            taskId: message.payload.taskId,
            error,
          });
        };
        if (this.paused) {
          emitScreenError("Agent is paused");
          break;
        }
        try {
          const result = await this.executor.captureScreen(message.payload.requestId, {
            maxWidth: message.payload.maxWidth ?? 1280,
            quality: message.payload.quality,
            taskId: message.payload.taskId,
          });
          if ("image" in result && result.image) {
            log.info("Sending SCREEN_RESULT", {
              requestId: result.requestId,
              width: result.width,
              height: result.height,
              bytes: Math.round((result.image.length * 3) / 4),
            });
            this.ws.emitEvent("SCREEN_RESULT", result);
          } else {
            const errMsg =
              "error" in result && typeof result.error === "string"
                ? result.error
                : "Screenshot failed";
            emitScreenError(errMsg);
          }
        } catch (error) {
          emitScreenError(error instanceof Error ? error.message : String(error));
        }
        break;
      }
      case "NOTIFY": {
        if (this.isDuplicate(`notify:${message.payload.requestId}`)) {
          log.info("Ignoring duplicate NOTIFY", { requestId: message.payload.requestId });
          return;
        }
        log.info("Received NOTIFY", {
          requestId: message.payload.requestId,
          title: message.payload.title,
        });
        try {
          const delivered = await this.notify.show(message.payload);
          this.ws.emitEvent("NOTIFY_RESULT", {
            requestId: message.payload.requestId,
            success: true,
            ...delivered,
          });
          log.info("NOTIFY delivered", { requestId: message.payload.requestId });
        } catch (error) {
          log.warn("NOTIFY failed", {
            requestId: message.payload.requestId,
            error: error instanceof Error ? error.message : String(error),
          });
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
      case "OPEN_APP":
      case "CLOSE_APP": {
        if (this.isDuplicate(`app:${message.event}:${message.payload.requestId}`)) return;
        const action = message.event === "OPEN_APP" ? "open" : "close";
        log.info(`Received ${message.event}`, {
          requestId: message.payload.requestId,
          app: message.payload.app,
        });
        try {
          if (this.paused) {
            throw new Error("Agent is paused");
          }
          const result =
            action === "open"
              ? await this.apps.openApp(message.payload.app)
              : await this.apps.closeApp(message.payload.app);
          this.ws.emitEvent("APP_ACTION_RESULT", {
            requestId: message.payload.requestId,
            action,
            app: result.app,
            success: true,
          });
        } catch (error) {
          this.ws.emitEvent("APP_ACTION_RESULT", {
            requestId: message.payload.requestId,
            action,
            app: message.payload.app,
            success: false,
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
