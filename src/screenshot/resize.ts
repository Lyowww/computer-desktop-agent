import { PNG } from "pngjs";

export function resizePngBuffer(
  buffer: Buffer,
  maxWidth?: number,
  deflateLevel = 6
): { width: number; height: number; compressed: boolean; buffer: Buffer } {
  const source = PNG.sync.read(buffer);
  if (!maxWidth || source.width <= maxWidth) {
    return {
      width: source.width,
      height: source.height,
      compressed: false,
      buffer: PNG.sync.write(source, { deflateLevel }),
    };
  }

  const scale = maxWidth / source.width;
  const targetWidth = Math.max(1, Math.floor(source.width * scale));
  const targetHeight = Math.max(1, Math.floor(source.height * scale));
  const target = new PNG({ width: targetWidth, height: targetHeight });

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.min(source.width - 1, Math.floor(x / scale));
      const srcY = Math.min(source.height - 1, Math.floor(y / scale));
      const srcIdx = (source.width * srcY + srcX) << 2;
      const dstIdx = (targetWidth * y + x) << 2;
      target.data[dstIdx] = source.data[srcIdx];
      target.data[dstIdx + 1] = source.data[srcIdx + 1];
      target.data[dstIdx + 2] = source.data[srcIdx + 2];
      target.data[dstIdx + 3] = source.data[srcIdx + 3];
    }
  }

  return {
    width: targetWidth,
    height: targetHeight,
    compressed: true,
    buffer: PNG.sync.write(target, { deflateLevel }),
  };
}
