/**
 * Maps AI/screenshot-space coordinates to native screen pixels for nut.js.
 *
 * Pipeline:
 *   AI image coords (after resize, e.g. 1280×832)
 *     → logical display points (Electron size / nut.js)
 *     → global desktop coords (+ display.bounds origin)
 *
 * Do NOT hardcode Retina 2x. Do NOT apply arbitrary x/y offsets.
 */
import { rootLogger } from "../../utils/logger";
import {
  analyzeCaptureVsDisplay,
  type CaptureGeometry,
  type DisplayGeometry,
} from "./DisplayGeometry";

const log = rootLogger.child("coordinate-mapper");

export type ScreenshotSpace = {
  width: number;
  height: number;
  /** Raw capture PNG size before resize (physical pixels on Retina). */
  nativeWidth?: number;
  nativeHeight?: number;
};

export type MappedPoint = {
  x: number;
  y: number;
  scaled: boolean;
  imageWidth: number;
  imageHeight: number;
  nativeWidth?: number;
  nativeHeight?: number;
  scaleX: number;
  scaleY: number;
  originX: number;
  originY: number;
  logicalWidth: number;
  logicalHeight: number;
};

export function isCoordinateMapDebugEnabled(): boolean {
  const v = process.env.MAP_COORDINATES_DEBUG?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export class CoordinateMapper {
  private space: ScreenshotSpace | null = null;
  /** Per-task screenshot spaces so overlapping captures cannot pollute clicks. */
  private readonly taskSpaces = new Map<string, ScreenshotSpace>();

  noteScreenshotSpace(
    width: number,
    height: number,
    taskId?: string,
    native?: { width: number; height: number }
  ): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return;
    }
    const next: ScreenshotSpace = {
      width,
      height,
      ...(native &&
      Number.isFinite(native.width) &&
      Number.isFinite(native.height) &&
      native.width > 0 &&
      native.height > 0
        ? { nativeWidth: native.width, nativeHeight: native.height }
        : {}),
    };
    this.space = next;
    if (taskId) {
      this.taskSpaces.set(taskId, next);
    }
  }

  clear(taskId?: string): void {
    if (taskId) {
      this.taskSpaces.delete(taskId);
      return;
    }
    this.space = null;
    this.taskSpaces.clear();
  }

  getScreenshotSpace(taskId?: string): ScreenshotSpace | null {
    if (taskId) {
      return this.taskSpaces.get(taskId) ?? this.space;
    }
    return this.space;
  }

  /**
   * Convert image-space (x, y) into global screen-space for nut.js.
   * Throws if no screenshot space is known — passthrough would mis-click on Retina.
   */
  toScreen(
    x: number,
    y: number,
    display: DisplayGeometry,
    taskId?: string
  ): MappedPoint {
    const space = this.getScreenshotSpace(taskId);
    if (!space) {
      throw new Error(
        "Screenshot coordinate space unknown; refuse to map AI coordinates to screen (capture a screenshot first)"
      );
    }

    const { width: imageWidth, height: imageHeight } = space;
    if (!(imageWidth > 0 && imageHeight > 0)) {
      throw new Error("Invalid screenshot space dimensions");
    }
    if (!(display.logicalWidth > 0 && display.logicalHeight > 0)) {
      throw new Error("Invalid display logical dimensions");
    }

    // Reject AI coords outside the screenshot they were planned against.
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x >= imageWidth ||
      y >= imageHeight
    ) {
      throw new Error(
        `AI coordinate (${x}, ${y}) outside screenshot ${imageWidth}x${imageHeight}`
      );
    }

    const scaleX = display.logicalWidth / imageWidth;
    const scaleY = display.logicalHeight / imageHeight;
    const scaled =
      Math.abs(scaleX - 1) > 1e-9 ||
      Math.abs(scaleY - 1) > 1e-9 ||
      display.originX !== 0 ||
      display.originY !== 0;

    const logicalX = x * scaleX;
    const logicalY = y * scaleY;
    const mappedX = Math.round(display.originX + logicalX);
    const mappedY = Math.round(display.originY + logicalY);

    const capture: CaptureGeometry = {
      imageWidth,
      imageHeight,
      nativeWidth: space.nativeWidth ?? imageWidth,
      nativeHeight: space.nativeHeight ?? imageHeight,
    };
    const analysis = analyzeCaptureVsDisplay(capture, display);

    if (analysis.scaleMismatch) {
      log.warn("Non-uniform screenshot→display scale — possible crop/letterbox", {
        scaleX,
        scaleY,
        image: { width: imageWidth, height: imageHeight },
        display: {
          width: display.logicalWidth,
          height: display.logicalHeight,
          scaleFactor: display.scaleFactor,
          source: display.source,
        },
        captureNative: {
          width: capture.nativeWidth,
          height: capture.nativeHeight,
        },
        expectedPhysical: {
          width: analysis.expectedPhysicalWidth,
          height: analysis.expectedPhysicalHeight,
        },
      });
    }

    if (
      space.nativeWidth &&
      space.nativeHeight &&
      !analysis.captureMatchesPhysical &&
      display.scaleFactor > 1
    ) {
      log.warn("Capture native size does not match logical×scaleFactor", {
        captureNative: {
          width: space.nativeWidth,
          height: space.nativeHeight,
        },
        expectedPhysical: {
          width: analysis.expectedPhysicalWidth,
          height: analysis.expectedPhysicalHeight,
        },
        scaleFactor: display.scaleFactor,
      });
    }

    const result: MappedPoint = {
      x: mappedX,
      y: mappedY,
      scaled,
      imageWidth,
      imageHeight,
      nativeWidth: space.nativeWidth,
      nativeHeight: space.nativeHeight,
      scaleX,
      scaleY,
      originX: display.originX,
      originY: display.originY,
      logicalWidth: display.logicalWidth,
      logicalHeight: display.logicalHeight,
    };

    if (isCoordinateMapDebugEnabled()) {
      console.log(
        [
          "[COORDINATE-MAP]",
          `Screenshot: width=${imageWidth} height=${imageHeight}`,
          `CaptureNative: width=${space.nativeWidth ?? "n/a"} height=${space.nativeHeight ?? "n/a"}`,
          `NativeLogical: width=${display.logicalWidth} height=${display.logicalHeight} origin=(${display.originX},${display.originY}) scaleFactor=${display.scaleFactor} source=${display.source}`,
          `Input: x=${x} y=${y}`,
          `Output: x=${mappedX} y=${mappedY}`,
          `Scale: x=${scaleX.toFixed(6)} y=${scaleY.toFixed(6)}`,
        ].join("\n")
      );
    }

    return result;
  }
}

export const coordinateMapper = new CoordinateMapper();
