import { BrowserWindow, session, systemPreferences } from "electron";
import { rootLogger } from "../utils/logger";

const log = rootLogger.child("camera");

export interface CameraCaptureOptions {
  /** JPEG quality 0–1 (default 0.85) */
  quality?: number;
  maxWidth?: number;
}

export interface CameraCaptureResult {
  width: number;
  height: number;
  format: "jpeg";
  mimeType: "image/jpeg";
  imageBase64: string;
}

const CAPTURE_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;background:#000">
<video id="v" autoplay playsinline muted style="width:1px;height:1px;opacity:0"></video>
<script>
window.__captureFrontCamera = async function(quality, maxWidth) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "user" },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  });
  try {
    const video = document.getElementById("v");
    video.srcObject = stream;
    await video.play();
    // Let auto-exposure settle so the frame is not black.
    await new Promise((r) => setTimeout(r, 550));
    if (!video.videoWidth || !video.videoHeight) {
      await new Promise((r) => setTimeout(r, 400));
    }
    let w = video.videoWidth || 640;
    let h = video.videoHeight || 480;
    if (maxWidth && w > maxWidth) {
      h = Math.round((h * maxWidth) / w);
      w = maxWidth;
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return { width: w, height: h, dataUrl };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
};
</script>
</body>
</html>`;

/**
 * One-shot front-camera still via Chromium getUserMedia in a hidden window.
 */
export class CameraService {
  private permissionHandlerInstalled = false;

  private ensureMediaPermissionHandler(): void {
    if (this.permissionHandlerInstalled) return;
    this.permissionHandlerInstalled = true;

    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      if (permission === "media" || permission === "mediaKeySystem") {
        callback(true);
        return;
      }
      callback(false);
    });

    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return permission === "media" || permission === "mediaKeySystem";
    });
  }

  async ensureCameraAccess(): Promise<boolean> {
    if (process.platform === "darwin") {
      try {
        const status = systemPreferences.getMediaAccessStatus("camera");
        if (status === "granted") return true;
        if (status === "denied" || status === "restricted") return false;
        return systemPreferences.askForMediaAccess("camera");
      } catch (error) {
        log.warn("askForMediaAccess(camera) failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    }
    return true;
  }

  async capture(options: CameraCaptureOptions = {}): Promise<CameraCaptureResult> {
    this.ensureMediaPermissionHandler();

    const granted = await this.ensureCameraAccess();
    if (!granted) {
      throw new Error(
        "Camera permission is not granted. Enable Camera for this app in System Settings → Privacy & Security → Camera, then retry."
      );
    }

    const quality = Math.min(1, Math.max(0.4, (options.quality ?? 85) / 100));
    const maxWidth = options.maxWidth ?? 1280;

    const win = new BrowserWindow({
      show: false,
      width: 8,
      height: 8,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    const timeoutMs = 20_000;
    let timer: NodeJS.Timeout | null = null;

    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(CAPTURE_HTML)}`);

      const capturePromise = win.webContents.executeJavaScript(
        `window.__captureFrontCamera(${quality}, ${maxWidth})`,
        true
      ) as Promise<{ width: number; height: number; dataUrl: string }>;

      const result = await Promise.race([
        capturePromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Front camera capture timed out after 20s")),
            timeoutMs
          );
        }),
      ]);

      if (!result?.dataUrl?.startsWith("data:image/")) {
        throw new Error("Camera returned an empty frame");
      }

      const imageBase64 = result.dataUrl.replace(/^data:image\/jpeg;base64,/, "");
      log.info("Captured front camera frame", {
        width: result.width,
        height: result.height,
        bytes: Math.round((imageBase64.length * 3) / 4),
      });

      return {
        width: result.width,
        height: result.height,
        format: "jpeg",
        mimeType: "image/jpeg",
        imageBase64,
      };
    } finally {
      if (timer) clearTimeout(timer);
      if (!win.isDestroyed()) win.destroy();
    }
  }
}
