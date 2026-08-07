export type ClientEvent =
  | "AUTH"
  | "PAIR"
  | "ACTION_RESULT"
  | "SCREEN_RESULT"
  | "STATUS"
  | "PONG"
  | "ERROR";

export interface AuthPayload {
  deviceId: string;
  deviceName: string;
  proof?: string;
  deviceToken?: string;
  nonce?: string;
  pairingCode?: string;
  platform: string;
  version: string;
}

export interface ActionResultPayload {
  actionId: string;
  success: boolean;
  status?: "OK" | "LOCKED" | "PAUSED" | "DENIED" | "ERROR";
  message?: string;
  data?: Record<string, unknown>;
}

export interface ScreenResultPayload {
  requestId: string;
  width: number;
  height: number;
  format: "png";
  imageBase64: string;
  compressed?: boolean;
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
