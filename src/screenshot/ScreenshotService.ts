import screenshot from "screenshot-desktop";
import { resizePngBuffer } from "./resize";
import { rootLogger } from "../utils/logger";
import { coordinateMapper } from "../automation/mouse/CoordinateMapper";

const log = rootLogger.child("screenshot");

export interface ScreenshotOptions {
  maxWidth?: number;
  /** 1-100; lower values increase PNG compression */
  quality?: number;
  /** When true (default), mouse actions map into this image's coordinate space. */
  bindCoordinateSpace?: boolean;
}

export interface ScreenshotResult {
  width: number;
  height: number;
  format: "png";
  imageBase64: string;
  compressed: boolean;
  /** Native capture size before optional downscale. */
  nativeWidth: number;
  nativeHeight: number;
}

export class ScreenshotService {
  /**
   * Capture the primary display once. Never streams continuously.
   * Returned width/height define the coordinate system for subsequent mouse actions.
   */
  async capture(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    const capturePromise = (async () => {
      const raw = (await screenshot({ format: "png" })) as Buffer;
      const deflateLevel = options.quality !== undefined && options.quality < 80 ? 9 : 6;
      const resized = resizePngBuffer(raw, options.maxWidth ?? 1280, deflateLevel);

      if (options.bindCoordinateSpace !== false) {
        coordinateMapper.noteScreenshotSpace(resized.width, resized.height);
      }

      log.info(`Screenshot captured: ${resized.width}x${resized.height}`, {
        width: resized.width,
        height: resized.height,
        nativeWidth: resized.nativeWidth,
        nativeHeight: resized.nativeHeight,
        bytes: resized.buffer.length,
        compressed: resized.compressed,
      });

      return {
        width: resized.width,
        height: resized.height,
        format: "png" as const,
        imageBase64: resized.buffer.toString("base64"),
        compressed: resized.compressed,
        nativeWidth: resized.nativeWidth,
        nativeHeight: resized.nativeHeight,
      };
    })();

    const timeoutMs = 12_000;
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        capturePromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Screenshot timed out after 12s")),
            timeoutMs
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
