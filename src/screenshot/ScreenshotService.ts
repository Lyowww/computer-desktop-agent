import screenshot from "screenshot-desktop";
import { resizePngBuffer } from "./resize";
import { rootLogger } from "../utils/logger";

const log = rootLogger.child("screenshot");

export interface ScreenshotOptions {
  maxWidth?: number;
  /** 1-100; lower values increase PNG compression */
  quality?: number;
}

export interface ScreenshotResult {
  width: number;
  height: number;
  format: "png";
  imageBase64: string;
  compressed: boolean;
}

export class ScreenshotService {
  /**
   * Capture the primary display once. Never streams continuously.
   */
  async capture(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    const capturePromise = (async () => {
      const raw = (await screenshot({ format: "png" })) as Buffer;
      const deflateLevel = options.quality !== undefined && options.quality < 80 ? 9 : 6;
      const resized = resizePngBuffer(raw, options.maxWidth ?? 1280, deflateLevel);

      log.info("Captured screenshot", {
        width: resized.width,
        height: resized.height,
        bytes: resized.buffer.length,
        compressed: resized.compressed,
      });

      return {
        width: resized.width,
        height: resized.height,
        format: "png" as const,
        imageBase64: resized.buffer.toString("base64"),
        compressed: resized.compressed,
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
