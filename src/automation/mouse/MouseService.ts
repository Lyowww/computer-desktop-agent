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
   * Rejects out-of-bounds coordinates instead of silently clamping.
   */
  async resolvePoint(
    x: number,
    y: number
  ): Promise<{ x: number; y: number; screenWidth: number; screenHeight: number }> {
    const bounds = await this.getScreenBounds();
    const mapped = this.coords.toScreen(x, y, bounds.width, bounds.height);
    const check = validateCoordinates(mapped.x, mapped.y, bounds.width, bounds.height);
    if (!check.ok) {
      throw new Error(check.error);
    }
    if (mapped.scaled) {
      log.info("Scaled coordinates from screenshot space", {
        from: { x, y },
        to: { x: mapped.x, y: mapped.y },
        screenshot: this.coords.getScreenshotSpace(),
        screen: bounds,
      });
    }
    return {
      x: mapped.x,
      y: mapped.y,
      screenWidth: bounds.width,
      screenHeight: bounds.height,
    };
  }

  async move(x: number, y: number): Promise<void> {
    const point = await this.resolvePoint(x, y);
    mouse.config.autoDelayMs = 0;
    await mouse.setPosition(new Point(point.x, point.y));
    log.info("Moved mouse", { x: point.x, y: point.y });
  }

  async click(x: number, y: number, button: MouseButtonName = "LEFT"): Promise<void> {
    const point = await this.resolvePoint(x, y);
    mouse.config.autoDelayMs = 0;
    await mouse.setPosition(new Point(point.x, point.y));
    await mouse.click(BUTTON_MAP[button]);
    log.info("Executing CLICK", { x: point.x, y: point.y, button });
  }

  async doubleClick(x: number, y: number, button: MouseButtonName = "LEFT"): Promise<void> {
    const point = await this.resolvePoint(x, y);
    mouse.config.autoDelayMs = 0;
    await mouse.setPosition(new Point(point.x, point.y));
    await mouse.doubleClick(BUTTON_MAP[button]);
    log.info("Executing DOUBLE_CLICK", { x: point.x, y: point.y, button });
  }
}
