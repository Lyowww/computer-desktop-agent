import { EventEmitter } from "events";
import WebSocket from "ws";
import { rootLogger } from "../utils/logger";

const log = rootLogger.child("websocket");

export interface ReconnectOptions {
  baseMs?: number;
  maxMs?: number;
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface AgentWebSocketEvents {
  open: [];
  close: [code: number, reason: string];
  error: [error: Error];
  message: [data: unknown];
  state: [state: ConnectionState];
}

export class AgentWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private url = "";
  private shouldReconnect = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private state: ConnectionState = "disconnected";
  private readonly baseMs: number;
  private readonly maxMs: number;

  constructor(options: ReconnectOptions = {}) {
    super();
    this.baseMs = options.baseMs ?? 1000;
    this.maxMs = options.maxMs ?? 30_000;
  }

  getConnectionState(): ConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === "connected" && this.ws?.readyState === WebSocket.OPEN;
  }

  connect(url: string): void {
    this.url = url;
    this.shouldReconnect = true;
    this.clearReconnectTimer();
    this.openSocket();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.attempt = 0;
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, "client disconnect");
      }
      this.ws = null;
    }
    this.setState("disconnected");
  }

  send(payload: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn("Cannot send; socket not open");
      return false;
    }
    this.ws.send(JSON.stringify(payload));
    return true;
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

    this.setState(this.attempt > 0 ? "reconnecting" : "connecting");
    log.info("Connecting to backend", { url: this.url, attempt: this.attempt });

    try {
      this.ws = new WebSocket(this.url);
    } catch (error) {
      log.error("Failed to construct WebSocket", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      this.attempt = 0;
      this.setState("connected");
      log.info("WebSocket connected");
      this.emit("open");
    });

    this.ws.on("message", (raw) => {
      try {
        const text = typeof raw === "string" ? raw : raw.toString("utf8");
        const data = JSON.parse(text) as unknown;
        this.emit("message", data);
      } catch (error) {
        log.warn("Received invalid JSON message", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    this.ws.on("error", (error) => {
      log.error("WebSocket error", { error: error.message });
      this.emit("error", error);
    });

    this.ws.on("close", (code, reasonBuf) => {
      const reason = reasonBuf.toString("utf8");
      log.warn("WebSocket closed", { code, reason });
      this.ws = null;
      this.emit("close", code, reason);
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      } else {
        this.setState("disconnected");
      }
    });
  }

  private scheduleReconnect(): void {
    this.attempt += 1;
    const delay = this.nextDelayMs(this.attempt);
    this.setState("reconnecting");
    log.info("Scheduling reconnect", { attempt: this.attempt, delayMs: delay });
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.openSocket();
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
