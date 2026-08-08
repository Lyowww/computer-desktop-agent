/**
 * Maps AI/screenshot-space coordinates to native screen pixels.
 *
 * The backend asks for screenshots with maxWidth (often 1280). The AI plans
 * clicks in that image space. Mouse automation must use the real display size
 * reported by nut-js (logical coordinates on macOS — not a hardcoded 2x Retina).
 */
export type ScreenshotSpace = {
  width: number;
  height: number;
};

export class CoordinateMapper {
  private space: ScreenshotSpace | null = null;
  /** Per-task screenshot spaces so overlapping captures cannot pollute clicks. */
  private readonly taskSpaces = new Map<string, ScreenshotSpace>();

  noteScreenshotSpace(width: number, height: number, taskId?: string): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return;
    }
    const next = { width, height };
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
   * Convert image-space (x, y) to screen-space, then the caller validates bounds.
   * Throws if no screenshot space is known — passthrough would mis-click on Retina.
   */
  toScreen(
    x: number,
    y: number,
    screenWidth: number,
    screenHeight: number,
    taskId?: string
  ): { x: number; y: number; scaled: boolean; imageWidth: number; imageHeight: number } {
    const space = this.getScreenshotSpace(taskId);
    if (!space) {
      throw new Error(
        "Screenshot coordinate space unknown; refuse to map AI coordinates to screen (capture a screenshot first)"
      );
    }

    const { width: imageWidth, height: imageHeight } = space;
    if (imageWidth === screenWidth && imageHeight === screenHeight) {
      return { x, y, scaled: false, imageWidth, imageHeight };
    }

    const sx = (x / imageWidth) * screenWidth;
    const sy = (y / imageHeight) * screenHeight;
    return {
      x: Math.round(sx),
      y: Math.round(sy),
      scaled: true,
      imageWidth,
      imageHeight,
    };
  }
}

export const coordinateMapper = new CoordinateMapper();
