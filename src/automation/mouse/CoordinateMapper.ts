/**
 * Maps AI/screenshot-space coordinates to native screen pixels.
 *
 * The backend asks for screenshots with maxWidth (often 1280). The AI plans
 * clicks in that image space. Mouse automation must use the real display size.
 */
export type ScreenshotSpace = {
  width: number;
  height: number;
};

export class CoordinateMapper {
  private space: ScreenshotSpace | null = null;

  noteScreenshotSpace(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return;
    }
    this.space = { width, height };
  }

  clear(): void {
    this.space = null;
  }

  getScreenshotSpace(): ScreenshotSpace | null {
    return this.space;
  }

  /**
   * Convert image-space (x, y) to screen-space, then the caller validates bounds.
   * If no screenshot space is known, returns the input unchanged.
   */
  toScreen(
    x: number,
    y: number,
    screenWidth: number,
    screenHeight: number
  ): { x: number; y: number; scaled: boolean } {
    if (!this.space) {
      return { x, y, scaled: false };
    }

    const { width: imageWidth, height: imageHeight } = this.space;
    if (imageWidth === screenWidth && imageHeight === screenHeight) {
      return { x, y, scaled: false };
    }

    const sx = (x / imageWidth) * screenWidth;
    const sy = (y / imageHeight) * screenHeight;
    return {
      x: Math.floor(sx),
      y: Math.floor(sy),
      scaled: true,
    };
  }
}

export const coordinateMapper = new CoordinateMapper();
