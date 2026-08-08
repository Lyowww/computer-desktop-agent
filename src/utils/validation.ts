import { z } from "zod";

export const MouseButtonSchema = z.preprocess((value) => {
  if (typeof value === "string") return value.trim().toUpperCase();
  return value;
}, z.enum(["LEFT", "RIGHT", "MIDDLE"]));

const Coord = z.number().finite();

export const ClickParamsSchema = z
  .object({
    x: Coord,
    y: Coord,
    button: MouseButtonSchema.default("LEFT"),
  })
  .passthrough();

export const DoubleClickParamsSchema = z
  .object({
    x: Coord,
    y: Coord,
    button: MouseButtonSchema.default("LEFT"),
  })
  .passthrough();

export const MoveMouseParamsSchema = z
  .object({
    x: Coord,
    y: Coord,
  })
  .passthrough();

export const TypeTextParamsSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(10_000)
      .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value), {
        message: "Text contains unsupported control characters",
      }),
  })
  .passthrough();

export const KeyPressParamsSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_+\-.]+$/, "Invalid key name"),
  })
  .passthrough();

function splitHotkeyToken(token: string): string[] {
  return token
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
}

export const HotkeyParamsSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  if (typeof obj.keys === "string") {
    obj.keys = splitHotkeyToken(obj.keys);
  } else if (Array.isArray(obj.keys) && obj.keys.length === 1 && typeof obj.keys[0] === "string") {
    const only = obj.keys[0];
    if (only.includes("+")) {
      obj.keys = splitHotkeyToken(only);
    }
  }
  return obj;
}, z
  .object({
    keys: z
      .array(
        z
          .string()
          .min(1)
          .max(64)
          .regex(/^[A-Za-z0-9_+\-.]+$/, "Invalid hotkey key name")
      )
      .min(1)
      .max(6),
  })
  .passthrough());

export const OpenAppParamsSchema = z
  .object({
    app: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/, "Invalid application name"),
  })
  .passthrough();

/** Bounded wait — reject extreme values rather than sleeping forever. */
export const WAIT_MS_MIN = 100;
export const WAIT_MS_MAX = 10_000;

export const WaitParamsSchema = z
  .object({
    ms: z.number().int().min(WAIT_MS_MIN).max(WAIT_MS_MAX).optional(),
    durationMs: z.number().int().min(WAIT_MS_MIN).max(WAIT_MS_MAX).optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.ms === undefined && value.durationMs === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ms or durationMs required" });
    }
  });

export const AskUserParamsSchema = z
  .object({
    question: z.string().min(1).max(2000),
    reason: z.string().max(1000).optional(),
  })
  .passthrough();

export const ScrollParamsSchema = z
  .object({
    x: Coord.optional(),
    y: Coord.optional(),
    deltaX: z.number().finite().optional(),
    deltaY: z.number().finite().optional(),
    amount: z.number().finite().optional(),
    direction: z.enum(["up", "down", "left", "right"]).optional(),
  })
  .passthrough();

export const DragParamsSchema = z
  .object({
    fromX: Coord,
    fromY: Coord,
    toX: Coord,
    toY: Coord,
  })
  .passthrough();

export const WireActionTypeSchema = z.enum([
  "SCREENSHOT",
  "CLICK",
  "DOUBLE_CLICK",
  "RIGHT_CLICK",
  "MOVE_MOUSE",
  "MOVE",
  "TYPE_TEXT",
  "TYPE",
  "KEY_PRESS",
  "KEY",
  "HOTKEY",
  "OPEN_APP",
  "WAIT",
  "SCROLL",
  "DRAG",
  "LOCK_SCREEN",
  "UNLOCK_SCREEN",
  "DONE",
  "FAIL",
  "ASK_USER",
]);

const ForbiddenKeys = ["command", "shell", "exec", "script", "powershell", "bash", "cmd"];

export const LooseParamsSchema = z.record(z.unknown()).superRefine((params, ctx) => {
  for (const key of Object.keys(params)) {
    if (ForbiddenKeys.includes(key.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden action parameter: ${key}`,
      });
    }
  }
});

export const ExecuteActionPayloadSchema = z
  .object({
    actionId: z.string().min(1),
    taskId: z.string().min(1),
    type: WireActionTypeSchema,
    params: LooseParamsSchema.default({}),
  })
  .strict();

export const ExecuteActionMessageSchema = z.object({
  event: z.literal("EXECUTE_ACTION"),
  payload: ExecuteActionPayloadSchema,
});

export const CaptureScreenMessageSchema = z.object({
  event: z.literal("CAPTURE_SCREEN"),
  payload: z.object({
    requestId: z.string().min(1),
    maxWidth: z.number().int().positive().max(7680).optional(),
    quality: z.number().int().min(1).max(100).optional(),
    taskId: z.string().optional(),
    deviceId: z.string().optional(),
  }),
});

export const CaptureCameraMessageSchema = z.object({
  event: z.literal("CAPTURE_CAMERA"),
  payload: z.object({
    requestId: z.string().min(1),
    maxWidth: z.number().int().positive().max(7680).optional(),
    quality: z.number().int().min(1).max(100).optional(),
    taskId: z.string().optional(),
    deviceId: z.string().optional(),
  }),
});

export const NotifyMessageSchema = z.object({
  event: z.literal("NOTIFY"),
  payload: z.object({
    requestId: z.string().min(1),
    title: z.string().max(200).optional(),
    body: z.string().min(1).max(4000),
    from: z.string().max(200).optional(),
  }),
});

export const ListProcessesMessageSchema = z.object({
  event: z.literal("LIST_PROCESSES"),
  payload: z.object({
    requestId: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional(),
  }),
});

export const ListAppsMessageSchema = z.object({
  event: z.literal("LIST_APPS"),
  payload: z.object({
    requestId: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional(),
  }),
});

export const OpenAppMessageSchema = z.object({
  event: z.literal("OPEN_APP"),
  payload: z.object({
    requestId: z.string().min(1),
    app: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9][A-Za-z0-9 _.'()-]*$/, "Invalid application name"),
  }),
});

export const CloseAppMessageSchema = z.object({
  event: z.literal("CLOSE_APP"),
  payload: z.object({
    requestId: z.string().min(1),
    app: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9][A-Za-z0-9 _.'()-]*$/, "Invalid application name"),
  }),
});

export const LockScreenMessageSchema = z.object({
  event: z.literal("LOCK_SCREEN"),
  payload: z.object({
    requestId: z.string().min(1),
  }),
});

export const UnlockScreenMessageSchema = z.object({
  event: z.literal("UNLOCK_SCREEN"),
  payload: z.object({
    requestId: z.string().min(1),
  }),
});

/** Events the desktop agent intentionally handles. */
export const ServerMessageSchema = z.discriminatedUnion("event", [
  ExecuteActionMessageSchema,
  CaptureScreenMessageSchema,
  CaptureCameraMessageSchema,
  NotifyMessageSchema,
  ListProcessesMessageSchema,
  ListAppsMessageSchema,
  OpenAppMessageSchema,
  CloseAppMessageSchema,
  LockScreenMessageSchema,
  UnlockScreenMessageSchema,
  z.object({
    event: z.literal("DEVICE_REGISTERED"),
    payload: z.object({
      deviceId: z.string().min(1),
      name: z.string().optional(),
      os: z.string().optional(),
      connectionStatus: z.string().optional(),
    }),
  }),
  z.object({
    event: z.literal("PING"),
    payload: z
      .object({
        requestId: z.string().optional(),
        nonce: z.string().optional(),
      })
      .nullable()
      .optional(),
  }),
  z.object({
    event: z.literal("PONG"),
    payload: z.record(z.unknown()).nullable().optional(),
  }),
  z.object({
    event: z.literal("ERROR"),
    payload: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.unknown().optional(),
      })
      .nullable(),
  }),
  z.object({
    event: z.literal("PAUSE"),
    payload: z.object({}).nullable().optional(),
  }),
  z.object({
    event: z.literal("RESUME"),
    payload: z.object({}).nullable().optional(),
  }),
]);

/** Backend noise we must ignore (Nest ack echoes, web-only events). */
export const IGNORED_SERVER_EVENTS = new Set([
  "ACK",
  "DEVICE_STATUS",
  "TASK_START",
  "TASK_UPDATE",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "AI_RESPONSE",
  "ACTION_RESULT",
  "SCREEN_RESULT",
  "CAMERA_RESULT",
  "USER_MESSAGE",
  "REGISTER_DEVICE",
  "PROCESSES_RESULT",
  "APPS_RESULT",
  "NOTIFY_RESULT",
  "APP_ACTION_RESULT",
  "LOCK_RESULT",
]);

export type ExecuteActionPayload = z.infer<typeof ExecuteActionPayloadSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type WireActionType = z.infer<typeof WireActionTypeSchema>;

export function validateCoordinates(
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: "Coordinates must be finite numbers" };
  }
  if (x < 0 || y < 0 || x >= screenWidth || y >= screenHeight) {
    return {
      ok: false,
      error: `Coordinates (${x}, ${y}) outside screen bounds ${screenWidth}x${screenHeight}`,
    };
  }
  return { ok: true };
}

export function normalizeActionType(
  type: WireActionType
):
  | "SCREENSHOT"
  | "CLICK"
  | "DOUBLE_CLICK"
  | "RIGHT_CLICK"
  | "MOVE_MOUSE"
  | "TYPE_TEXT"
  | "KEY_PRESS"
  | "HOTKEY"
  | "OPEN_APP"
  | "WAIT"
  | "SCROLL"
  | "DRAG"
  | "LOCK_SCREEN"
  | "UNLOCK_SCREEN"
  | "DONE"
  | "FAIL"
  | "ASK_USER" {
  switch (type) {
    case "TYPE":
      return "TYPE_TEXT";
    case "KEY":
      return "KEY_PRESS";
    case "MOVE":
      return "MOVE_MOUSE";
    default:
      return type;
  }
}

/** Events that must carry a real object payload (Nest null echoes are noise). */
const COMMAND_EVENTS_REQUIRING_PAYLOAD = new Set([
  "EXECUTE_ACTION",
  "CAPTURE_SCREEN",
  "CAPTURE_CAMERA",
  "NOTIFY",
  "LIST_PROCESSES",
  "LIST_APPS",
  "OPEN_APP",
  "CLOSE_APP",
  "LOCK_SCREEN",
  "UNLOCK_SCREEN",
]);

/**
 * Normalize raw socket payloads before Zod.
 * Drops null Nest echoes and ignored event names.
 * Maps Nest-style `{ event, data }` → `{ event, payload }`.
 */
export function normalizeIncomingMessage(
  raw: unknown
): { kind: "ignore"; reason: string } | { kind: "ok"; message: unknown } {
  if (!raw || typeof raw !== "object") {
    return { kind: "ignore", reason: "non-object" };
  }
  const obj = { ...(raw as Record<string, unknown>) };
  const event = obj.event;
  if (typeof event !== "string") {
    return { kind: "ignore", reason: "missing event" };
  }
  if (IGNORED_SERVER_EVENTS.has(event)) {
    return { kind: "ignore", reason: `ignored event ${event}` };
  }

  // Nest IoAdapter uses `data`; our protocol uses `payload`.
  if (
    (obj.payload === null || obj.payload === undefined) &&
    obj.data !== null &&
    obj.data !== undefined
  ) {
    obj.payload = obj.data;
  }

  if (obj.payload === null || obj.payload === undefined) {
    // Nest IoAdapter re-emits `{ event, data: undefined }` → null payload echoes
    if (
      event === "DEVICE_REGISTERED" ||
      event === "PONG" ||
      event === "ERROR" ||
      event === "ACK" ||
      event === "PING" ||
      event === "PAUSE" ||
      event === "RESUME" ||
      COMMAND_EVENTS_REQUIRING_PAYLOAD.has(event)
    ) {
      return { kind: "ignore", reason: `null payload echo for ${event}` };
    }
  }

  return { kind: "ok", message: obj };
}
