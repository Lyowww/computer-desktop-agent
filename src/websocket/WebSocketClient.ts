import { EventEmitter } from "events";
import { io, Socket } from "socket.io-client";
import { rootLogger } from "../utils/logger";
import { toSocketIoUrl } from "../config/env";

const log = rootLogger.child("websocket");

export interface ReconnectOptions {
  baseMs?: number;
  maxMs?: number;
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

/**
 * Socket.IO client matching the Computer Agent Backend (`namespace /ws`, channel=desktop-agent).
 */
export class AgentWebSocketClient extends EventEmitter {
  private socket: Socket | null = null;
  private url = "";
  private shouldReconnect = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private state: ConnectionState = "disconnected";
  private readonly baseMs: number;
  private readonly maxMs: number;
  private intentionalClose = false;

  constructor(options: ReconnectOptions = {}) {
    super();
    this.baseMs = options.baseMs ?? 1000;
    this.maxMs = options.maxMs ?? 30_000;
  }

  getConnectionState(): ConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === "connected" && Boolean(this.socket?.connected);
  }

  connect(url: string): void {
    this.url = toSocketIoUrl(url);
    this.shouldReconnect = true;
    this.intentionalClose = false;
    this.clearReconnectTimer();
    this.openSocket();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.attempt = 0;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.setState("disconnected");
  }

  /**
   * Emit a named Socket.IO event (preferred by the Nest gateway).
   */
  emitEvent(event: string, payload: unknown): boolean {
    if (!this.socket?.connected) {
      log.warn("Cannot emit; socket not connected", { event });
      return false;
    }
    this.socket.emit(event, payload);
    return true;
  }

  /**
   * Backward-compatible helper: accepts { event, payload } envelopes.
   */
  send(payload: unknown): boolean {
    if (
      payload &&
      typeof payload === "object" &&
      "event" in payload &&
      typeof (payload as { event: unknown }).event === "string"
    ) {
      const envelope = payload as { event: string; payload: unknown };
      return this.emitEvent(envelope.event, envelope.payload);
    }
    return this.emitEvent("message", payload);
  }

  /**
   * Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at maxMs (default 30s).
   */
  nextDelayMs(attempt = this.attempt): number {
    const exp = Math.min(this.baseMs * 2 ** Math.max(attempt - 1, 0), this.maxMs);
    return Math.min(exp, this.maxMs);
  }

  private openSocket(): void {
    if (!this.url) {
      throw new Error("WebSocket URL not set");
    }

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.setState(this.attempt > 0 ? "reconnecting" : "connecting");
    log.info("Connecting to backend", { url: this.url, attempt: this.attempt });

    this.socket = io(this.url, {
      transports: ["websocket", "polling"],
      query: { channel: "desktop-agent" },
      autoConnect: true,
      reconnection: false, // we own backoff so it matches product requirements
      timeout: 20_000,
      forceNew: true,
    });

    this.socket.on("connect", () => {
      this.attempt = 0;
      this.setState("connected");
      log.info("Socket.IO connected", { id: this.socket?.id });
      this.emit("open");
    });

    this.socket.on("disconnect", (reason) => {
      log.warn("Socket.IO disconnected", { reason });
      this.emit("close", 0, reason);
      if (this.shouldReconnect && !this.intentionalClose) {
        this.scheduleReconnect();
      } else {
        this.setState("disconnected");
      }
    });

    this.socket.on("connect_error", (error) => {
      // Do not emit EventEmitter "error" — with no listener Node throws Uncaught Exception
      // and Electron shows a fatal dialog on transient network / backend wake failures.
      const message = error.message || String(error);
      log.error("Socket.IO connection error", { error: message, url: this.url });
      this.emit("connectionError", error);
      if (this.shouldReconnect && !this.intentionalClose) {
        this.scheduleReconnect();
      } else {
        this.setState("disconnected");
      }
    });

    // Named events from backend
    const known = new Set([
      "DEVICE_REGISTERED",
      "EXECUTE_ACTION",
      "CAPTURE_SCREEN",
      "NOTIFY",
      "LIST_PROCESSES",
      "LIST_APPS",
      "PING",
      "PONG",
      "ERROR",
      "PAUSE",
      "RESUME",
      "ACK",
      "message",
    ]);

    const commandEvents = new Set([
      "CAPTURE_SCREEN",
      "NOTIFY",
      "EXECUTE_ACTION",
      "LIST_PROCESSES",
      "LIST_APPS",
      "DEVICE_REGISTERED",
      "PING",
      "ERROR",
      "PAUSE",
      "RESUME",
    ]);

    const payloadSummary = (payload: unknown): Record<string, unknown> => {
      if (payload === null) return { payload: null };
      if (payload === undefined) return { payload: "undefined" };
      if (typeof payload !== "object") return { payloadType: typeof payload };
      const obj = payload as Record<string, unknown>;
      return {
        payloadKeys: Object.keys(obj),
        requestId: typeof obj.requestId === "string" ? obj.requestId : undefined,
        hasBody: typeof obj.body === "string",
      };
    };

    const forward = (event: string) => (payload: unknown) => {
      if (commandEvents.has(event)) {
        log.info("Socket inbound", { event, via: "named", ...payloadSummary(payload) });
      }
      this.emit("message", { event, payload });
    };

    for (const event of known) {
      if (event === "message") continue;
      this.socket.on(event, forward(event));
    }

    // Surface unexpected inbound events in Logs (helps diagnose routing gaps).
    this.socket.onAny((event: string, ...args: unknown[]) => {
      if (event === "connect" || event === "disconnect") return;
      if (known.has(event)) return;
      log.info("Socket inbound (unhandled name)", {
        event,
        ...payloadSummary(args[0]),
      });
    });

    // Envelope form also emitted by ConnectionRegistry
    this.socket.on("message", (envelope: unknown) => {
      if (
        envelope &&
        typeof envelope === "object" &&
        "event" in envelope &&
        typeof (envelope as { event: unknown }).event === "string"
      ) {
        const env = envelope as { event: string; payload?: unknown; data?: unknown };
        if (commandEvents.has(env.event)) {
          log.info("Socket inbound", {
            event: env.event,
            via: "envelope",
            ...payloadSummary(env.payload ?? env.data),
          });
        }
        this.emit("message", envelope);
      } else {
        log.warn("Socket inbound envelope ignored", {
          type: envelope === null ? "null" : typeof envelope,
        });
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.attempt += 1;
    const delay = this.nextDelayMs(this.attempt);
    this.setState("reconnecting");
    log.info("Scheduling reconnect", { attempt: this.attempt, delayMs: delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        this.openSocket();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit("state", state);
  }
}
