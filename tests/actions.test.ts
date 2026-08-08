import { describe, expect, it, beforeEach } from "vitest";
import { CoordinateMapper } from "../src/automation/mouse/CoordinateMapper";
import {
  ExecuteActionPayloadSchema,
  WaitParamsSchema,
  HotkeyParamsSchema,
  ClickParamsSchema,
  AskUserParamsSchema,
  validateCoordinates,
} from "../src/utils/validation";

describe("coordinate mapper", () => {
  let mapper: CoordinateMapper;

  beforeEach(() => {
    mapper = new CoordinateMapper();
  });

  it("scales screenshot-space clicks to native screen pixels", () => {
    mapper.noteScreenshotSpace(1280, 720);
    const mapped = mapper.toScreen(640, 360, 2560, 1440);
    expect(mapped.scaled).toBe(true);
    expect(mapped.x).toBe(1280);
    expect(mapped.y).toBe(720);
  });

  it("does not scale when spaces match", () => {
    mapper.noteScreenshotSpace(1920, 1080);
    const mapped = mapper.toScreen(100, 200, 1920, 1080);
    expect(mapped.scaled).toBe(false);
    expect(mapped).toMatchObject({ x: 100, y: 200 });
  });

  it("passes through when no screenshot space is known", () => {
    const mapped = mapper.toScreen(10, 20, 800, 600);
    expect(mapped.scaled).toBe(false);
    expect(mapped).toMatchObject({ x: 10, y: 20 });
  });
});

describe("action routing validation", () => {
  it("accepts AI computer-agent action types", () => {
    for (const type of [
      "CLICK",
      "DOUBLE_CLICK",
      "MOVE_MOUSE",
      "TYPE_TEXT",
      "KEY_PRESS",
      "HOTKEY",
      "OPEN_APP",
      "WAIT",
      "SCREENSHOT",
      "DONE",
      "ASK_USER",
    ] as const) {
      expect(() =>
        ExecuteActionPayloadSchema.parse({
          actionId: "a1",
          taskId: "00000000-0000-4000-8000-000000000001",
          type,
          params: {},
        })
      ).not.toThrow();
    }
  });

  it("rejects unknown and shell-like actions", () => {
    expect(() =>
      ExecuteActionPayloadSchema.parse({
        actionId: "a1",
        taskId: "00000000-0000-4000-8000-000000000001",
        type: "SHELL",
        params: { command: "ls" },
      })
    ).toThrow();
  });

  it("rejects malformed payloads", () => {
    expect(() =>
      ExecuteActionPayloadSchema.parse({
        actionId: "",
        taskId: "bad",
        type: "CLICK",
      })
    ).toThrow();
  });

  it("normalizes lowercase mouse buttons", () => {
    expect(ClickParamsSchema.parse({ x: 1, y: 2, button: "left" }).button).toBe("LEFT");
  });

  it("parses CMD+L style hotkeys", () => {
    expect(HotkeyParamsSchema.parse({ keys: "CMD+L" }).keys).toEqual(["CMD", "L"]);
    expect(HotkeyParamsSchema.parse({ keys: ["Meta+C"] }).keys).toEqual(["Meta", "C"]);
  });

  it("enforces WAIT bounds 100–10000ms", () => {
    expect(WaitParamsSchema.parse({ ms: 100 }).ms).toBe(100);
    expect(WaitParamsSchema.parse({ ms: 10_000 }).ms).toBe(10_000);
    expect(() => WaitParamsSchema.parse({ ms: 50 })).toThrow();
    expect(() => WaitParamsSchema.parse({ ms: 60_000 })).toThrow();
  });

  it("validates ASK_USER params", () => {
    expect(
      AskUserParamsSchema.parse({ question: "Continue purchase?", reason: "payment" }).question
    ).toBe("Continue purchase?");
  });
});

describe("ActionResult shape helpers", () => {
  it("coordinate validation rejects edges at screenWidth/Height", () => {
    expect(validateCoordinates(1919, 1079, 1920, 1080).ok).toBe(true);
    expect(validateCoordinates(1920, 0, 1920, 1080).ok).toBe(false);
    expect(validateCoordinates(0, 1080, 1920, 1080).ok).toBe(false);
  });
});
