import { screen, mouse, Button, Point } from "@nut-tree-fork/nut-js";
import { validateCoordinates } from "../../utils/validation";
import { rootLogger } from "../../utils/logger";
import {
  CoordinateMapper,
  coordinateMapper,
  isCoordinateMapDebugEnabled,
} from "./CoordinateMapper";
import { getDisplayGeometry } from "./DisplayGeometry";
import {
  isCoordinateDebugOverlayEnabled,
  writeDebugOverlayFile,
} from "../../screenshot/debugOverlay";

const log = rootLogger.child("mouse");

export type MouseButtonName = "LEFT" | "RIGHT" | "MIDDLE";

const BUTTON_MAP: Record<MouseButtonName, Button> = {
  LEFT: Button.LEFT,
  RIGHT: Button.RIGHT,
  MIDDLE: Button.MIDDLE,
};

export interface ScreenBounds {
  width: number;
  height: number;
  originX: number;
  originY: number;
  scaleFactor: number;
}

export class MouseService {
  constructor(private readonly coords: CoordinateMapper = coordinateMapper) {}

  async getScreenBounds(): Promise<ScreenBounds> {
    const nutWidth = await screen.width();
    const nutHeight = await screen.height();
    const display = await getDisplayGeometry(nutWidth, nutHeight);
    return {
      width: display.logicalWidth,
      height: display.logicalHeight,
      originX: display.originX,
      originY: display.originY,
      scaleFactor: display.scaleFactor,
    };
  }

  /**
   * Map AI/screenshot coordinates → global nut.js screen pixels and validate.
   * Uses measured screenshot space vs display logical size (+ origin).
   */
  async resolvePoint(
    x: number,
    y: number,
    taskId?: string
  ): Promise<{
    x: number;
    y: number;
    screenWidth: number;
    screenHeight: number;
    originX: number;
    originY: number;
  }> {
    const nutWidth = await screen.width();
    const nutHeight = await screen.height();
    const display = await getDisplayGeometry(nutWidth, nutHeight);
    const mapped = this.coords.toScreen(x, y, display, taskId);

    // Validate against the display's logical rectangle in global space.
    const localX = mapped.x - display.originX;
    const localY = mapped.y - display.originY;
    const check = validateCoordinates(
      localX,
      localY,
      display.logicalWidth,
      display.logicalHeight
    );
    if (!check.ok) {
      throw new Error(
        `${check.error} (mapped global=(${mapped.x},${mapped.y}) origin=(${display.originX},${display.originY}))`
      );
    }

    const prefix = taskId ? `[task=${taskId}] ` : "";
    log.info(
      `${prefix}AI coordinate: x=${x} y=${y} | AI image: ${mapped.imageWidth}x${mapped.imageHeight} | native mapped: x=${mapped.x} y=${mapped.y}`,
      {
        from: { x, y },
        to: { x: mapped.x, y: mapped.y },
        screenshot: {
          width: mapped.imageWidth,
          height: mapped.imageHeight,
          nativeWidth: mapped.nativeWidth,
          nativeHeight: mapped.nativeHeight,
        },
        display: {
          logicalWidth: display.logicalWidth,
          logicalHeight: display.logicalHeight,
          originX: display.originX,
          originY: display.originY,
          scaleFactor: display.scaleFactor,
          source: display.source,
        },
        nutjs: { width: nutWidth, height: nutHeight },
        scale: { x: mapped.scaleX, y: mapped.scaleY },
        scaled: mapped.scaled,
        taskId,
      }
    );

    if (isCoordinateMapDebugEnabled()) {
      console.log(
        JSON.stringify({
          level: "INFO",
          stage: "COORDINATE_MAP",
          SCREENSHOT_WIDTH: mapped.imageWidth,
          SCREENSHOT_HEIGHT: mapped.imageHeight,
          NATIVE_SCREEN_WIDTH: display.logicalWidth,
          NATIVE_SCREEN_HEIGHT: display.logicalHeight,
          DEVICE_PIXEL_RATIO: display.scaleFactor,
          DISPLAY_ORIGIN_X: display.originX,
          DISPLAY_ORIGIN_Y: display.originY,
          AI_X: x,
          AI_Y: y,
          MAPPED_X: mapped.x,
          MAPPED_Y: mapped.y,
          SCALE_X: mapped.scaleX,
          SCALE_Y: mapped.scaleY,
          taskId,
        })
      );
    }

    if (isCoordinateDebugOverlayEnabled()) {
      try {
        writeDebugOverlayFile({
          imageWidth: mapped.imageWidth,
          imageHeight: mapped.imageHeight,
          aiX: x,
          aiY: y,
          mappedX: mapped.x,
          mappedY: mapped.y,
          taskId,
        });
      } catch (err) {
        log.warn("Failed to write coordinate debug overlay", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      x: mapped.x,
      y: mapped.y,
      screenWidth: display.logicalWidth,
      screenHeight: display.logicalHeight,
      originX: display.originX,
      originY: display.originY,
    };
  }

  async move(x: number, y: number, taskId?: string): Promise<void> {
    const point = await this.resolvePoint(x, y, taskId);
    mouse.config.autoDelayMs = 0;
    await mouse.setPosition(new Point(point.x, point.y));
    log.info("Moved mouse", { x: point.x, y: point.y, taskId });
  }

  async click(
    x: number,
    y: number,
    button: MouseButtonName = "LEFT",
    taskId?: string
  ): Promise<void> {
    const point = await this.resolvePoint(x, y, taskId);
    mouse.config.autoDelayMs = 0;
    await mouse.setPosition(new Point(point.x, point.y));
    await mouse.click(BUTTON_MAP[button]);
    log.info("Executing CLICK", { x: point.x, y: point.y, button, taskId });
  }

  async doubleClick(
    x: number,
    y: number,
    button: MouseButtonName = "LEFT",
    taskId?: string
  ): Promise<void> {
    const point = await this.resolvePoint(x, y, taskId);
    mouse.config.autoDelayMs = 0;
    await mouse.setPosition(new Point(point.x, point.y));
    await mouse.doubleClick(BUTTON_MAP[button]);
    log.info("Executing DOUBLE_CLICK", { x: point.x, y: point.y, button, taskId });
  }
}
