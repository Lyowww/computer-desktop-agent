import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { CoordinateMapper } from "../src/automation/mouse/CoordinateMapper";
import {
  analyzeCaptureVsDisplay,
  setDisplayGeometryOverride,
  type DisplayGeometry,
} from "../src/automation/mouse/DisplayGeometry";
import {
  ExecuteActionPayloadSchema,
  WaitParamsSchema,
  HotkeyParamsSchema,
  ClickParamsSchema,
  AskUserParamsSchema,
  validateCoordinates,
} from "../src/utils/validation";

function display(
  partial: Partial<DisplayGeometry> &
    Pick<DisplayGeometry, "logicalWidth" | "logicalHeight">
): DisplayGeometry {
  return {
    originX: 0,
    originY: 0,
    scaleFactor: 1,
    source: "override",
    ...partial,
  };
}

describe("coordinate mapper", () => {
  let mapper: CoordinateMapper;

  beforeEach(() => {
    mapper = new CoordinateMapper();
    setDisplayGeometryOverride(null);
  });

  afterEach(() => {
    setDisplayGeometryOverride(null);
  });

  it("scales screenshot-space clicks to native logical pixels", () => {
    mapper.noteScreenshotSpace(1280, 720);
    const mapped = mapper.toScreen(640, 360, display({ logicalWidth: 2560, logicalHeight: 1440 }));
    expect(mapped.scaled).toBe(true);
    expect(mapped.x).toBe(1280);
    expect(mapped.y).toBe(720);
  });

  it("does not scale when spaces match and origin is zero", () => {
    mapper.noteScreenshotSpace(1920, 1080);
    const mapped = mapper.toScreen(100, 200, display({ logicalWidth: 1920, logicalHeight: 1080 }));
    expect(mapped.scaled).toBe(false);
    expect(mapped).toMatchObject({ x: 100, y: 200 });
  });

  it("refuses to map when no screenshot space is known", () => {
    expect(() =>
      mapper.toScreen(10, 20, display({ logicalWidth: 800, logicalHeight: 600 }))
    ).toThrow(/coordinate space unknown/i);
  });

  it("prefers per-task screenshot space over global", () => {
    mapper.noteScreenshotSpace(1280, 800, "task-a");
    mapper.noteScreenshotSpace(640, 400, "task-b");
    const a = mapper.toScreen(
      100,
      100,
      display({ logicalWidth: 2560, logicalHeight: 1600 }),
      "task-a"
    );
    const b = mapper.toScreen(
      100,
      100,
      display({ logicalWidth: 2560, logicalHeight: 1600 }),
      "task-b"
    );
    expect(a.x).toBe(Math.round((100 / 1280) * 2560));
    expect(b.x).toBe(Math.round((100 / 640) * 2560));
  });

  it("uses Math.round (not floor) when scaling", () => {
    mapper.noteScreenshotSpace(1280, 832);
    const mapped = mapper.toScreen(
      104,
      469,
      display({ logicalWidth: 2880, logicalHeight: 1872 })
    );
    expect(mapped.x).toBe(Math.round((104 / 1280) * 2880));
    expect(mapped.y).toBe(Math.round((469 / 832) * 1872));
  });

  it("maps 1280×832 screenshot onto 1470×956 logical Retina points", () => {
    mapper.noteScreenshotSpace(1280, 832, undefined, {
      width: 2940,
      height: 1912,
    });
    const mapped = mapper.toScreen(
      900,
      790,
      display({
        logicalWidth: 1470,
        logicalHeight: 956,
        scaleFactor: 2,
      })
    );
    expect(mapped.x).toBe(Math.round((900 / 1280) * 1470));
    expect(mapped.y).toBe(Math.round((790 / 832) * 956));
    expect(Math.abs(mapped.scaleX - mapped.scaleY)).toBeLessThan(0.02);
  });

  it("maps 1920×1080 screenshot onto matching native screen", () => {
    mapper.noteScreenshotSpace(1920, 1080);
    const mapped = mapper.toScreen(
      960,
      540,
      display({ logicalWidth: 1920, logicalHeight: 1080 })
    );
    expect(mapped.x).toBe(960);
    expect(mapped.y).toBe(540);
  });

  it("applies multi-monitor display origin", () => {
    mapper.noteScreenshotSpace(1280, 832);
    const mapped = mapper.toScreen(
      10,
      10,
      display({
        logicalWidth: 1280,
        logicalHeight: 832,
        originX: 1920,
        originY: 0,
      })
    );
    expect(mapped.x).toBe(1930);
    expect(mapped.y).toBe(10);
  });

  it("maps calibration corners: top-left, center, bottom-right", () => {
    mapper.noteScreenshotSpace(1280, 832);
    const geo = display({ logicalWidth: 1470, logicalHeight: 956, scaleFactor: 2 });

    const tl = mapper.toScreen(0, 0, geo);
    expect(tl.x).toBe(0);
    expect(tl.y).toBe(0);

    const center = mapper.toScreen(640, 416, geo);
    expect(center.x).toBe(Math.round((640 / 1280) * 1470));
    expect(center.y).toBe(Math.round((416 / 832) * 956));

    const br = mapper.toScreen(1279, 831, geo);
    expect(br.x).toBe(Math.round((1279 / 1280) * 1470));
    expect(br.y).toBe(Math.round((831 / 832) * 956));
    expect(br.x).toBeLessThan(1470);
    expect(br.y).toBeLessThan(956);
  });

  it("rejects AI coordinates outside the screenshot", () => {
    mapper.noteScreenshotSpace(1280, 832);
    expect(() =>
      mapper.toScreen(1280, 100, display({ logicalWidth: 1470, logicalHeight: 956 }))
    ).toThrow(/outside screenshot/i);
    expect(() =>
      mapper.toScreen(100, -1, display({ logicalWidth: 1470, logicalHeight: 956 }))
    ).toThrow(/outside screenshot/i);
  });

  it("detects Retina 2x capture vs logical display", () => {
    const analysis = analyzeCaptureVsDisplay(
      {
        imageWidth: 1280,
        imageHeight: 832,
        nativeWidth: 2560,
        nativeHeight: 1664,
      },
      display({ logicalWidth: 1280, logicalHeight: 832, scaleFactor: 2 })
    );
    expect(analysis.captureMatchesPhysical).toBe(true);
    expect(analysis.scaleMismatch).toBe(false);
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
