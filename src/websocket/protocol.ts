export type ClientEvent =
  | "REGISTER_DEVICE"
  | "ACTION_RESULT"
  | "SCREEN_RESULT"
  | "STATUS"
  | "PONG"
  | "ERROR"
  | "PING"
  | "DEVICE_TELEMETRY";

export interface RegisterDevicePayload {
  deviceToken: string;
  deviceName: string;
  os: "darwin" | "win32" | "linux";
}

export interface ActionResultPayload {
  actionId: string;
  taskId: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
  /** Local-only enrichment (not always sent to backend) */
  status?: "OK" | "LOCKED" | "PAUSED" | "DENIED" | "ERROR";
}

export interface ScreenResultPayload {
  requestId: string;
  taskId?: string;
  width?: number;
  height?: number;
  image?: string;
  mimeType?: "image/png" | "image/jpeg" | "image/webp";
  error?: string;
}

export interface StatusPayload {
  online: boolean;
  connected: boolean;
  paused: boolean;
  locked: boolean;
  deviceId: string;
  paired: boolean;
  permissions: {
    accessibility: boolean;
    screenRecording: boolean;
  };
}

export function buildMessage<T>(event: ClientEvent, payload: T): { event: ClientEvent; payload: T } {
  return { event, payload };
}
