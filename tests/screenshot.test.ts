import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { resizePngBuffer } from "../src/screenshot/resize";

describe("screenshot handling", () => {
  it("resizes oversized captures when maxWidth is set", () => {
    const wide = new PNG({ width: 2000, height: 1000 });
    for (let i = 0; i < wide.data.length; i += 4) {
      wide.data[i] = 10;
      wide.data[i + 1] = 20;
      wide.data[i + 2] = 30;
      wide.data[i + 3] = 255;
    }
    const buffer = PNG.sync.write(wide);
    const result = resizePngBuffer(buffer, 800);
    expect(result.width).toBe(800);
    expect(result.height).toBe(400);
    expect(result.nativeWidth).toBe(2000);
    expect(result.nativeHeight).toBe(1000);
    expect(result.compressed).toBe(true);
  });

  it("does not compress when already within maxWidth", () => {
    const png = new PNG({ width: 100, height: 50 });
    png.data.fill(255);
    const buffer = PNG.sync.write(png);
    const result = resizePngBuffer(buffer, 800);
    expect(result.width).toBe(100);
    expect(result.compressed).toBe(false);
  });
});
