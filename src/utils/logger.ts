export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface LogEntry {
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
  "screenshot",
  "privateKey",
  "secret",
];

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redact(nested);
      }
    }
    return out;
  }
  return value;
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
      timestamp: new Date().toISOString(),
      level,
      message: `[${this.scope}] ${message}`,
      ...(context ? { context: redact(context) as Record<string, unknown> } : {}),
    };

    const line = JSON.stringify(entry);
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
