import { describe, expect, it } from "vitest";
import {
  ExecuteActionMessageSchema,
  ExecuteActionPayloadSchema,
  validateCoordinates,
  TypeTextParamsSchema,
  HotkeyParamsSchema,
  KeyPressParamsSchema,
} from "../src/utils/validation";

describe("action validation", () => {
  it("accepts a valid CLICK action", () => {
    const parsed = ExecuteActionMessageSchema.parse({
      event: "EXECUTE_ACTION",
      payload: {
        actionId: "act_123",
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
        type: "SHELL",
        params: { command: "rm -rf /" },
      })
    ).toThrow();
  });

  it("rejects arbitrary code-like payloads", () => {
    expect(() =>
      ExecuteActionPayloadSchema.parse({
        actionId: "act_1",
        type: "TYPE_TEXT",
        params: { text: "ok", eval: "process.exit(1)" },
      })
    ).toThrow();
  });

  it("validates WAIT bounds", () => {
    expect(() =>
      ExecuteActionPayloadSchema.parse({
        actionId: "act_1",
        type: "WAIT",
        params: { ms: 120_000 },
      })
    ).toThrow();
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
      HotkeyParamsSchema.parse({ keys: ["a", "b", "c", "d", "e", "f"] })
    ).toThrow();
  });
});
