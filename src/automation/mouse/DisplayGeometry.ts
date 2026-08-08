/**
 * Resolve the display geometry used for screenshots + mouse control.
 *
 * On macOS Retina:
 * - screenshot-desktop typically captures PHYSICAL pixels (size × scaleFactor)
 * - nut.js / Electron mouse APIs use LOGICAL points in a global virtual desktop
 * - display.bounds.x/y may be non-zero with multiple monitors
 *
 * Never hardcode devicePixelRatio = 2.
 */
import { rootLogger } from "../../utils/logger";

const log = rootLogger.child("display-geometry");

export interface DisplayGeometry {
  /** Global desktop origin of the captured display (logical points). */
  originX: number;
  originY: number;
  /** Logical width/height in the same space nut.js mouse uses. */
  logicalWidth: number;
  logicalHeight: number;
  /** Electron/OS scale factor when available (1 on non-Retina). */
  scaleFactor: number;
  /** Source used to obtain geometry. */
  source: "electron" | "nutjs" | "override";
  displayId?: number;
}

export interface CaptureGeometry {
  /** AI / screenshot image dimensions (after optional resize). */
  imageWidth: number;
  imageHeight: number;
  /** Raw PNG capture dimensions before resize. */
  nativeWidth: number;
  nativeHeight: number;
}

let geometryOverride: DisplayGeometry | null = null;

/** Test / calibration helper — inject measured geometry without Electron. */
export function setDisplayGeometryOverride(geometry: DisplayGeometry | null): void {
  geometryOverride = geometry;
}

function readElectronPrimaryDisplay(): DisplayGeometry | null {
  try {
    // Lazy require so unit tests can run outside Electron.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as {
      screen?: {
        getPrimaryDisplay: () => {
          id: number;
          bounds: { x: number; y: number; width: number; height: number };
          size: { width: number; height: number };
          scaleFactor: number;
        };
      };
    };
    const display = electron.screen?.getPrimaryDisplay?.();
    if (!display) return null;
    const bounds = display.bounds;
    const size = display.size;
    const scaleFactor =
      typeof display.scaleFactor === "number" && display.scaleFactor > 0
        ? display.scaleFactor
        : 1;
    return {
      originX: bounds.x,
      originY: bounds.y,
      logicalWidth: size.width || bounds.width,
      logicalHeight: size.height || bounds.height,
      scaleFactor,
      source: "electron",
      displayId: display.id,
    };
  } catch {
    return null;
  }
}

export async function getDisplayGeometry(
  nutWidth?: number,
  nutHeight?: number
): Promise<DisplayGeometry> {
  if (geometryOverride) {
    return geometryOverride;
  }

  const fromElectron = readElectronPrimaryDisplay();
  if (fromElectron) {
    // Prefer Electron bounds (includes multi-monitor origin). Cross-check nut-js size.
    if (
      typeof nutWidth === "number" &&
      typeof nutHeight === "number" &&
      (Math.abs(nutWidth - fromElectron.logicalWidth) > 2 ||
        Math.abs(nutHeight - fromElectron.logicalHeight) > 2)
    ) {
      log.warn("Electron display size differs from nut.js screen size", {
        electron: {
          width: fromElectron.logicalWidth,
          height: fromElectron.logicalHeight,
          originX: fromElectron.originX,
          originY: fromElectron.originY,
          scaleFactor: fromElectron.scaleFactor,
        },
        nutjs: { width: nutWidth, height: nutHeight },
      });
    }
    return fromElectron;
  }

  if (
    typeof nutWidth === "number" &&
    typeof nutHeight === "number" &&
    nutWidth > 0 &&
    nutHeight > 0
  ) {
    return {
      originX: 0,
      originY: 0,
      logicalWidth: nutWidth,
      logicalHeight: nutHeight,
      scaleFactor: 1,
      source: "nutjs",
    };
  }

  throw new Error("Unable to resolve display geometry for coordinate mapping");
}

/**
 * Estimate whether capture native pixels match logical×scaleFactor.
 * Large mismatches may indicate wrong-display capture or letterboxing.
 */
export function analyzeCaptureVsDisplay(
  capture: CaptureGeometry,
  display: DisplayGeometry
): {
  expectedPhysicalWidth: number;
  expectedPhysicalHeight: number;
  captureMatchesPhysical: boolean;
  scaleX: number;
  scaleY: number;
  scaleMismatch: boolean;
} {
  const expectedPhysicalWidth = Math.round(
    display.logicalWidth * display.scaleFactor
  );
  const expectedPhysicalHeight = Math.round(
    display.logicalHeight * display.scaleFactor
  );
  const captureMatchesPhysical =
    Math.abs(capture.nativeWidth - expectedPhysicalWidth) <= 2 &&
    Math.abs(capture.nativeHeight - expectedPhysicalHeight) <= 2;

  const scaleX = display.logicalWidth / capture.imageWidth;
  const scaleY = display.logicalHeight / capture.imageHeight;
  const scaleMismatch = Math.abs(scaleX - scaleY) > 0.02;

  return {
    expectedPhysicalWidth,
    expectedPhysicalHeight,
    captureMatchesPhysical,
    scaleX,
    scaleY,
    scaleMismatch,
  };
}
