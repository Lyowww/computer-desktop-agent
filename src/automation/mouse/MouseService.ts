import { screen, mouse, Button, Point } from "@nut-tree-fork/nut-js";
import { validateCoordinates } from "../../utils/validation";
import { rootLogger } from "../../utils/logger";

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
  async getScreenBounds(): Promise<ScreenBounds> {
    const width = await screen.width();
    const height = await screen.height();
    return { width, height };
  }

  async move(x: number, y: number): Promise<void> {
    const bounds = await this.getScreenBounds();
    const check = validateCoordinates(x, y, bounds.width, bounds.height);
    if (!check.ok) {
      throw new Error(check.error);
    }
    mouse.config.autoDelayMs = 0;
    await mouse.setPosition(new Point(Math.floor(x), Math.floor(y)));
    log.info("Moved mouse", { x, y });
  }

  async click(x: number, y: number, button: MouseButtonName = "LEFT"): Promise<void> {
    await this.move(x, y);
    await mouse.click(BUTTON_MAP[button]);
    log.info("Clicked", { x, y, button });
  }

  async doubleClick(x: number, y: number, button: MouseButtonName = "LEFT"): Promise<void> {
    await this.move(x, y);
    await mouse.doubleClick(BUTTON_MAP[button]);
    log.info("Double-clicked", { x, y, button });
  }
}
