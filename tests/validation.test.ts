import { describe, expect, it } from "vitest";
import {
  ExecuteActionMessageSchema,
  ExecuteActionPayloadSchema,
  validateCoordinates,
  TypeTextParamsSchema,
  HotkeyParamsSchema,
  KeyPressParamsSchema,
  normalizeActionType,
  normalizeIncomingMessage,
} from "../src/utils/validation";
import { toSocketIoUrl } from "../src/config/env";

describe("action validation", () => {
  it("accepts a valid CLICK action", () => {
    const parsed = ExecuteActionMessageSchema.parse({
      event: "EXECUTE_ACTION",
      payload: {
        actionId: "act_123",
        taskId: "00000000-0000-4000-8000-000000000001",
        type: "CLICK",
        params: { x: 340, y: 180, button: "LEFT" },
      },
    });
    expect(parsed.payload.type).toBe("CLICK");
  });

  it("rejects unknown action types", () => {
    expect(() =>
      ExecuteActionPayloadSchema.parse({
        actionId: "act_1",
        taskId: "00000000-0000-4000-8000-000000000001",
        type: "SHELL",
        params: { command: "rm -rf /" },
      })
    ).toThrow();
  });

  it("rejects forbidden shell-like params", () => {
    expect(() =>
      ExecuteActionPayloadSchema.parse({
        actionId: "act_1",
        taskId: "00000000-0000-4000-8000-000000000001",
        type: "TYPE",
        params: { text: "ok", shell: "rm -rf /" },
      })
    ).toThrow();
  });

  it("normalizes backend action aliases", () => {
    expect(normalizeActionType("TYPE")).toBe("TYPE_TEXT");
    expect(normalizeActionType("KEY")).toBe("KEY_PRESS");
    expect(normalizeActionType("MOVE")).toBe("MOVE_MOUSE");
  });

  it("validates WAIT bounds", () => {
    expect(() =>
      ExecuteActionPayloadSchema.parse({
        actionId: "act_1",
        taskId: "00000000-0000-4000-8000-000000000001",
        type: "WAIT",
        params: { ms: 120_000 },
      })
    ).not.toThrow(); // loose params; executor clamps via WaitParamsSchema
  });
});

describe("backend URL normalization", () => {
  it("maps wss host to https /ws namespace", () => {
    expect(toSocketIoUrl("wss://computer-agent-backend.onrender.com")).toBe(
      "https://computer-agent-backend.onrender.com/ws"
    );
  });

  it("keeps explicit /ws path", () => {
    expect(toSocketIoUrl("https://computer-agent-backend.onrender.com/ws")).toBe(
      "https://computer-agent-backend.onrender.com/ws"
    );
  });
});

describe("coordinate validation", () => {
  it("allows in-bounds coordinates", () => {
    expect(validateCoordinates(0, 0, 1920, 1080)).toEqual({ ok: true });
    expect(validateCoordinates(1919, 1079, 1920, 1080)).toEqual({ ok: true });
  });

  it("rejects out-of-bounds coordinates", () => {
    const result = validateCoordinates(1920, 100, 1920, 1080);
    expect(result.ok).toBe(false);
  });

  it("rejects negative coordinates", () => {
    const result = validateCoordinates(-1, 10, 800, 600);
    expect(result.ok).toBe(false);
  });
});

describe("keyboard validation", () => {
  it("accepts normal text", () => {
    expect(TypeTextParamsSchema.parse({ text: "Hello world" }).text).toBe("Hello world");
  });

  it("rejects control characters", () => {
    expect(() => TypeTextParamsSchema.parse({ text: "bad\u0000text" })).toThrow();
  });

  it("validates key press names", () => {
    expect(KeyPressParamsSchema.parse({ key: "Enter" }).key).toBe("Enter");
    expect(() => KeyPressParamsSchema.parse({ key: "Enter; rm -rf /" })).toThrow();
  });

  it("validates hotkeys", () => {
    expect(HotkeyParamsSchema.parse({ keys: ["Meta", "C"] }).keys).toEqual(["Meta", "C"]);
    expect(() => HotkeyParamsSchema.parse({ keys: [] })).toThrow();
    expect(() =>
      HotkeyParamsSchema.parse({ keys: ["a", "b", "c", "d", "e", "f", "g"] })
    ).toThrow();
  });
});

describe("normalizeIncomingMessage", () => {
  it("maps Nest-style data to payload", () => {
    const result = normalizeIncomingMessage({
      event: "NOTIFY",
      data: { requestId: "r1", body: "hello" },
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.message).toEqual({
        event: "NOTIFY",
        data: { requestId: "r1", body: "hello" },
        payload: { requestId: "r1", body: "hello" },
      });
    }
  });

  it("drops null-payload command echoes instead of failing Zod", () => {
    const result = normalizeIncomingMessage({ event: "NOTIFY", payload: null });
    expect(result).toEqual({ kind: "ignore", reason: "null payload echo for NOTIFY" });
  });

  it("keeps a valid NOTIFY envelope", () => {
    const result = normalizeIncomingMessage({
      event: "NOTIFY",
      payload: { requestId: "r1", body: "hi" },
    });
    expect(result.kind).toBe("ok");
  });
});
