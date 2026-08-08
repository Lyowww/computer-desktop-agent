import { describe, expect, it, vi, beforeEach } from "vitest";
import { ActionExecutor } from "../src/agent/ActionExecutor";

vi.mock("@nut-tree-fork/nut-js", () => ({
  mouse: {
    config: { autoDelayMs: 0 },
    setPosition: vi.fn(),
    click: vi.fn(),
    doubleClick: vi.fn(),
    pressButton: vi.fn(),
    releaseButton: vi.fn(),
    scrollUp: vi.fn(),
    scrollDown: vi.fn(),
    scrollLeft: vi.fn(),
    scrollRight: vi.fn(),
  },
  keyboard: {
    config: { autoDelayMs: 0 },
    type: vi.fn(),
    pressKey: vi.fn(),
    releaseKey: vi.fn(),
  },
  screen: {
    width: vi.fn(async () => 1920),
    height: vi.fn(async () => 1080),
  },
  Button: { LEFT: 0, RIGHT: 1, MIDDLE: 2 },
  Key: {},
  Point: class {
    constructor(
      public x: number,
      public y: number
    ) {}
  },
}));

describe("ActionExecutor with mocked OS automation", () => {
  const mouseSvc = {
    click: vi.fn(),
    doubleClick: vi.fn(),
    move: vi.fn(),
    resolvePoint: vi.fn(async (x: number, y: number) => ({
      x,
      y,
      screenWidth: 1920,
      screenHeight: 1080,
    })),
    getScreenBounds: vi.fn(async () => ({ width: 1920, height: 1080 })),
  };
  const keyboard = {
    typeText: vi.fn(),
    keyPress: vi.fn(),
    hotkey: vi.fn(),
  };
  const apps = {
    openApp: vi.fn(async (app: string) => ({ app })),
    closeApp: vi.fn(async (app: string) => ({ app })),
  };
  const screenshots = {
    capture: vi.fn(async () => ({
      width: 1280,
      height: 720,
      format: "png" as const,
      imageBase64: "abc",
      compressed: true,
      nativeWidth: 2560,
      nativeHeight: 1440,
    })),
  };
  const permissions = {
    assertReadyForInput: vi.fn(),
    assertReadyForScreenshot: vi.fn(),
    assertReadyForCamera: vi.fn(),
  };
  const lockScreen = {
    isLocked: vi.fn(async () => false),
  };
  const unlock = {
    ensureUnlocked: vi.fn(async () => ({ ok: true })),
    openLockScreen: vi.fn(),
  };

  let executor: ActionExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new ActionExecutor(
      mouseSvc as never,
      keyboard as never,
      apps as never,
      screenshots as never,
      undefined as never,
      permissions as never,
      lockScreen as never,
      unlock as never
    );
  });

  it("routes CLICK without moving the real mouse", async () => {
    const result = await executor.execute(
      {
        actionId: "a1",
        taskId: "00000000-0000-4000-8000-000000000001",
        type: "CLICK",
        params: { x: 100, y: 200, button: "LEFT" },
      },
      { paused: false }
    );
    expect(result.success).toBe(true);
    expect(mouseSvc.click).toHaveBeenCalledWith(
      100,
      200,
      "LEFT",
      "00000000-0000-4000-8000-000000000001"
    );
    expect(result.result).toMatchObject({ executedAt: expect.any(String) });
  });

  it("returns ActionResult failure for unknown apps", async () => {
    apps.openApp.mockRejectedValueOnce(
      new Error('Application "bash" was not found.'),
    );
    const result = await executor.execute(
      {
        actionId: "a2",
        taskId: "00000000-0000-4000-8000-000000000001",
        type: "OPEN_APP",
        params: { app: "bash" },
      },
      { paused: false }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("was not found");
  });

  it("acknowledges ASK_USER without OS side effects", async () => {
    const result = await executor.execute(
      {
        actionId: "a3",
        taskId: "00000000-0000-4000-8000-000000000001",
        type: "ASK_USER",
        params: { question: "Continue?" },
      },
      { paused: false }
    );
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ askUser: true, question: "Continue?" });
    expect(mouseSvc.click).not.toHaveBeenCalled();
  });

  it("returns screenshot payload for SCREENSHOT action", async () => {
    const result = await executor.execute(
      {
        actionId: "a4",
        taskId: "00000000-0000-4000-8000-000000000001",
        type: "SCREENSHOT",
        params: {},
      },
      { paused: false }
    );
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      width: 1280,
      height: 720,
      image: "abc",
      mimeType: "image/png",
    });
  });

  it("routes SCROLL via nut.js scroll APIs (never click)", async () => {
    const { mouse } = await import("@nut-tree-fork/nut-js");
    const result = await executor.execute(
      {
        actionId: "a6",
        taskId: "00000000-0000-4000-8000-000000000001",
        type: "SCROLL",
        params: { direction: "down", amount: 5 },
      },
      { paused: false }
    );
    expect(result.success).toBe(true);
    expect(mouse.scrollDown).toHaveBeenCalledWith(5);
    expect(mouseSvc.click).not.toHaveBeenCalled();
  });

  it("rejects invalid WAIT durations via schema", async () => {
    const result = await executor.execute(
      {
        actionId: "a5",
        taskId: "00000000-0000-4000-8000-000000000001",
        type: "WAIT",
        params: { ms: 50 },
      },
      { paused: false }
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
