import { EventEmitter } from "events";

export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface LogEntry {
  id: number;
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

const SENSITIVE_KEYS = [
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "deviceSecret",
  "authToken",
  "pairingSecret",
  "imageBase64",
  "image",
  "screenshot",
  "privateKey",
  "secret",
  "deviceToken",
  "jwt",
  "openrouter",
  "apiKey",
  "apikey",
];

/** Keys whose string values are truncated (never log full TYPE_TEXT content). */
const TRUNCATE_KEYS = new Set(["text", "question", "body"]);

const MAX_BUFFER = 500;
let nextId = 1;
const buffer: LogEntry[] = [];
const bus = new EventEmitter();
bus.setMaxListeners(50);

function redact(value: unknown, keyHint?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        out[key] = "[REDACTED]";
      } else if (TRUNCATE_KEYS.has(key.toLowerCase()) && typeof nested === "string") {
        out[key] =
          nested.length <= 8
            ? `[len=${nested.length}]`
            : `[len=${nested.length} prefix=${JSON.stringify(nested.slice(0, 4))}…]`;
      } else {
        out[key] = redact(nested, key);
      }
    }
    return out;
  }
  if (keyHint && TRUNCATE_KEYS.has(keyHint.toLowerCase()) && typeof value === "string") {
    return value.length <= 8
      ? `[len=${value.length}]`
      : `[len=${value.length} prefix=${JSON.stringify(value.slice(0, 4))}…]`;
  }
  return value;
}

function pushEntry(entry: LogEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) {
    buffer.splice(0, buffer.length - MAX_BUFFER);
  }
  bus.emit("log", entry);
}

export function getRecentLogs(limit = MAX_BUFFER): LogEntry[] {
  if (limit >= buffer.length) return [...buffer];
  return buffer.slice(buffer.length - limit);
}

export function clearLogs(): void {
  buffer.length = 0;
  bus.emit("cleared");
}

export function onLog(
  listener: (entry: LogEntry) => void
): () => void {
  bus.on("log", listener);
  return () => bus.off("log", listener);
}

export function onLogsCleared(listener: () => void): () => void {
  bus.on("cleared", listener);
  return () => bus.off("cleared", listener);
}

export class Logger {
  private readonly scope: string;

  constructor(scope: string) {
    this.scope = scope;
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.write("INFO", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.write("WARN", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.write("ERROR", message, context);
  }

  child(scope: string): Logger {
    return new Logger(`${this.scope}:${scope}`);
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      id: nextId++,
      timestamp: new Date().toISOString(),
      level,
      message: `[${this.scope}] ${message}`,
      ...(context ? { context: redact(context) as Record<string, unknown> } : {}),
    };

    pushEntry(entry);

    const line = JSON.stringify({
      timestamp: entry.timestamp,
      level: entry.level,
      message: entry.message,
      ...(entry.context ? { context: entry.context } : {}),
    });
    if (level === "ERROR") {
      console.error(line);
    } else if (level === "WARN") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

export const rootLogger = new Logger("agent");
