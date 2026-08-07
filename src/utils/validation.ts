import { z } from "zod";

export const MouseButtonSchema = z.enum(["LEFT", "RIGHT", "MIDDLE"]);

export const ClickParamsSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    button: MouseButtonSchema.default("LEFT"),
  })
  .strict();

export const DoubleClickParamsSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    button: MouseButtonSchema.default("LEFT"),
  })
  .strict();

export const MoveMouseParamsSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

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
  .strict();

export const KeyPressParamsSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9_+\-.]+$/, "Invalid key name"),
  })
  .strict();

export const HotkeyParamsSchema = z
  .object({
    keys: z
      .array(
        z
          .string()
          .min(1)
          .max(32)
          .regex(/^[A-Za-z0-9_+\-.]+$/, "Invalid hotkey key name")
      )
      .min(1)
      .max(5),
  })
  .strict();

export const OpenAppParamsSchema = z
  .object({
    app: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/, "Invalid application name"),
  })
  .strict();

export const WaitParamsSchema = z
  .object({
    ms: z.number().int().min(0).max(60_000),
  })
  .strict();

export const ActionTypeSchema = z.enum([
  "SCREENSHOT",
  "CLICK",
  "DOUBLE_CLICK",
  "MOVE_MOUSE",
  "TYPE_TEXT",
  "KEY_PRESS",
  "HOTKEY",
  "OPEN_APP",
  "WAIT",
]);

export const ExecuteActionPayloadSchema = z.discriminatedUnion("type", [
  z
    .object({
      actionId: z.string().min(1),
      type: z.literal("SCREENSHOT"),
      params: z.object({}).strict().default({}),
    })
    .strict(),
  z
    .object({
      actionId: z.string().min(1),
      type: z.literal("CLICK"),
      params: ClickParamsSchema,
    })
    .strict(),
  z
    .object({
      actionId: z.string().min(1),
      type: z.literal("DOUBLE_CLICK"),
      params: DoubleClickParamsSchema,
    })
    .strict(),
  z
    .object({
      actionId: z.string().min(1),
      type: z.literal("MOVE_MOUSE"),
      params: MoveMouseParamsSchema,
    })
    .strict(),
  z
    .object({
      actionId: z.string().min(1),
      type: z.literal("TYPE_TEXT"),
      params: TypeTextParamsSchema,
    })
    .strict(),
  z
    .object({
      actionId: z.string().min(1),
      type: z.literal("KEY_PRESS"),
      params: KeyPressParamsSchema,
    })
    .strict(),
  z
    .object({
      actionId: z.string().min(1),
      type: z.literal("HOTKEY"),
      params: HotkeyParamsSchema,
    })
    .strict(),
  z
    .object({
      actionId: z.string().min(1),
      type: z.literal("OPEN_APP"),
      params: OpenAppParamsSchema,
    })
    .strict(),
  z
    .object({
      actionId: z.string().min(1),
      type: z.literal("WAIT"),
      params: WaitParamsSchema,
    })
    .strict(),
]);

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
  }),
});

export const ServerMessageSchema = z.discriminatedUnion("event", [
  ExecuteActionMessageSchema,
  CaptureScreenMessageSchema,
  z.object({
    event: z.literal("AUTH_RESULT"),
    payload: z.object({
      success: z.boolean(),
      message: z.string().optional(),
      deviceToken: z.string().optional(),
    }),
  }),
  z.object({
    event: z.literal("PAIR_RESULT"),
    payload: z.object({
      success: z.boolean(),
      message: z.string().optional(),
      deviceToken: z.string().optional(),
    }),
  }),
  z.object({
    event: z.literal("PING"),
    payload: z.object({}).optional(),
  }),
  z.object({
    event: z.literal("PAUSE"),
    payload: z.object({}).optional(),
  }),
  z.object({
    event: z.literal("RESUME"),
    payload: z.object({}).optional(),
  }),
]);

export type ExecuteActionPayload = z.infer<typeof ExecuteActionPayloadSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type ActionType = z.infer<typeof ActionTypeSchema>;

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
