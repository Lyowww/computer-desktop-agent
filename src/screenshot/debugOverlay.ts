/**
 * Development-only coordinate debug overlay.
 * NEVER send overlay images to the AI vision model.
 */
import { PNG } from "pngjs";

export function isCoordinateDebugOverlayEnabled(): boolean {
  const v = process.env.DEBUG_COORDINATE_OVERLAY?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Draw a crosshair + optional grid on a PNG buffer for local inspection.
 */
export function drawCoordinateMarker(
  pngBuffer: Buffer,
  x: number,
  y: number,
  options?: { grid?: boolean; step?: number }
): Buffer {
  const img = PNG.sync.read(pngBuffer);
  const cx = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(img.height - 1, Math.round(y)));

  const setPixel = (px: number, py: number, r: number, g: number, b: number) => {
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) return;
    const idx = (img.width * py + px) << 2;
    img.data[idx] = r;
    img.data[idx + 1] = g;
    img.data[idx + 2] = b;
    img.data[idx + 3] = 255;
  };

  if (options?.grid) {
    const step = options.step ?? 100;
    for (let gx = 0; gx < img.width; gx += step) {
      for (let gy = 0; gy < img.height; gy++) {
        setPixel(gx, gy, 40, 40, 40);
      }
    }
    for (let gy = 0; gy < img.height; gy += step) {
      for (let gx = 0; gx < img.width; gx++) {
        setPixel(gx, gy, 40, 40, 40);
      }
    }
  }

  const arm = 18;
  for (let i = -arm; i <= arm; i++) {
    setPixel(cx + i, cy, 255, 0, 0);
    setPixel(cx, cy + i, 255, 0, 0);
  }
  // Center dot
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setPixel(cx + dx, cy + dy, 255, 255, 0);
    }
  }

  return PNG.sync.write(img);
}
