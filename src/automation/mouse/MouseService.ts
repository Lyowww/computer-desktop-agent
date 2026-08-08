import { screen, mouse, Button, Point } from "@nut-tree-fork/nut-js";
import { validateCoordinates } from "../../utils/validation";
import { rootLogger } from "../../utils/logger";
import { CoordinateMapper, coordinateMapper } from "./CoordinateMapper";

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
}

export class MouseService {
  constructor(private readonly coords: CoordinateMapper = coordinateMapper) {}

  async getScreenBounds(): Promise<ScreenBounds> {
    const width = await screen.width();
    const height = await screen.height();
    return { width, height };
  }

  /**
   * Map AI/screenshot coordinates → native screen pixels and validate.
   * Uses measured screenshot space vs nut-js screen size (handles Retina without hardcoding 2x).
   */
  async resolvePoint(
    x: number,
    y: number,
    taskId?: string
  ): Promise<{ x: number; y: number; screenWidth: number; screenHeight: number }> {
    const bounds = await this.getScreenBounds();
    const mapped = this.coords.toScreen(x, y, bounds.width, bounds.height, taskId);
    const check = validateCoordinates(mapped.x, mapped.y, bounds.width, bounds.height);
    if (!check.ok) {
      throw new Error(check.error);
    }

    const prefix = taskId ? `[task=${taskId}] ` : "";
    log.info(
      `${prefix}AI coordinate: x=${x} y=${y} | AI image: ${mapped.imageWidth}x${mapped.imageHeight} | native mapped: x=${mapped.x} y=${mapped.y}`,
      {
        from: { x, y },
        to: { x: mapped.x, y: mapped.y },
        screenshot: { width: mapped.imageWidth, height: mapped.imageHeight },
        screen: bounds,
        scaled: mapped.scaled,
        taskId,
      }
    );

    return {
      x: mapped.x,
      y: mapped.y,
      screenWidth: bounds.width,
      screenHeight: bounds.height,
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
