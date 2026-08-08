/**
 * Development-only coordinate debug overlay.
 * NEVER send overlay images to the AI vision model.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

/**
 * Create a blank debug canvas with AI click marker and metadata text as pixels
 * (no font dependency — writes a sidecar JSON next to a marked PNG).
 */
export function writeDebugOverlayFile(input: {
  imageWidth: number;
  imageHeight: number;
  aiX: number;
  aiY: number;
  mappedX: number;
  mappedY: number;
  taskId?: string;
}): string {
  const dir = path.join(os.tmpdir(), "petai-coordinate-debug");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `coord-${stamp}${input.taskId ? `-${input.taskId.slice(0, 8)}` : ""}`;

  const blank = new PNG({
    width: Math.max(1, Math.round(input.imageWidth)),
    height: Math.max(1, Math.round(input.imageHeight)),
  });
  blank.data.fill(20);
  const marked = drawCoordinateMarker(PNG.sync.write(blank), input.aiX, input.aiY, {
    grid: true,
    step: 100,
  });
  const pngPath = path.join(dir, `${base}.png`);
  const jsonPath = path.join(dir, `${base}.json`);
  fs.writeFileSync(pngPath, marked);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        screenshot: { width: input.imageWidth, height: input.imageHeight },
        ai: { x: input.aiX, y: input.aiY },
        mapped: { x: input.mappedX, y: input.mappedY },
        taskId: input.taskId,
        note: "AI crosshair is in screenshot space. Mapped values are nut.js global coords.",
      },
      null,
      2
    )
  );
  return pngPath;
}
