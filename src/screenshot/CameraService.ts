import { BrowserWindow, session, systemPreferences, app } from "electron";
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
<body style="margin:0;background:#111;color:#fff;font:14px -apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">
<video id="v" autoplay playsinline muted style="max-width:100%;max-height:100%"></video>
<p id="msg" style="position:absolute;bottom:8px;left:8px;right:8px;margin:0;opacity:.7;font-size:12px">Requesting camera…</p>
<script>
window.__captureFrontCamera = async function(quality, maxWidth) {
  const msg = document.getElementById("msg");
  msg.textContent = "Waiting for Camera permission…";
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "user" },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  });
  try {
    msg.textContent = "Capturing…";
    const video = document.getElementById("v");
    video.srcObject = stream;
    await video.play();
    // Let auto-exposure settle so the frame is not black.
    await new Promise((r) => setTimeout(r, 650));
    if (!video.videoWidth || !video.videoHeight) {
      await new Promise((r) => setTimeout(r, 500));
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
 * One-shot front-camera still via Chromium getUserMedia.
 * Uses a short-lived visible window so macOS shows the Camera TCC prompt
 * and lists this app under System Settings → Privacy & Security → Camera.
 */
export class CameraService {
  private permissionHandlerInstalled = false;

  private ensureMediaPermissionHandler(): void {
    if (this.permissionHandlerInstalled) return;
    this.permissionHandlerInstalled = true;

    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      // Allow Chromium to proceed; macOS TCC still owns the real camera grant.
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

  /** Current TCC status for logging / UI. */
  getCameraStatus(): string {
    if (process.platform !== "darwin") return "granted";
    try {
      return systemPreferences.getMediaAccessStatus("camera");
    } catch {
      return "unknown";
    }
  }

  /**
   * Prompt macOS Camera access. Returns true when granted.
   * Always calls askForMediaAccess when not already granted so the app
   * appears in System Settings → Camera.
   */
  async ensureCameraAccess(): Promise<boolean> {
    if (process.platform !== "darwin") return true;

    try {
      let status = systemPreferences.getMediaAccessStatus("camera");
      log.info("Camera TCC status before prompt", { status });

      if (status === "granted") return true;

      // Shows the system sheet and registers this binary in Camera settings.
      const allowed = await systemPreferences.askForMediaAccess("camera");
      status = systemPreferences.getMediaAccessStatus("camera");
      log.info("Camera TCC status after prompt", { allowed, status });
      return allowed || status === "granted";
    } catch (error) {
      log.warn("askForMediaAccess(camera) failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private cameraDeniedMessage(): string {
    let appLabel = "Computer Desktop Agent";
    try {
      appLabel = app.getName() || appLabel;
    } catch {
      // ignore
    }
    return [
      `Camera permission is not granted for “${appLabel}”.`,
      "Open System Settings → Privacy & Security → Camera and enable this app.",
      "If it is missing from the list, quit the agent and run:",
      "tccutil reset Camera com.petai.computer-desktop-agent",
      "then reopen the app and tap Camera again so macOS can show the allow prompt.",
    ].join(" ");
  }

  async capture(options: CameraCaptureOptions = {}): Promise<CameraCaptureResult> {
    this.ensureMediaPermissionHandler();

    const granted = await this.ensureCameraAccess();
    const status = this.getCameraStatus();
    log.info("Starting camera capture", { granted, status });

    // Even if askForMediaAccess returned false, still attempt getUserMedia once —
    // a visible window often triggers the TCC prompt that registers the app.
    const quality = Math.min(1, Math.max(0.4, (options.quality ?? 85) / 100));
    const maxWidth = options.maxWidth ?? 1280;

    const win = new BrowserWindow({
      // Must be visible briefly — fully hidden windows often skip the Camera TCC prompt.
      show: true,
      width: 360,
      height: 270,
      title: "Camera permission",
      alwaysOnTop: true,
      skipTaskbar: false,
      focusable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false,
      },
    });

    win.setMenuBarVisibility(false);
    try {
      win.center();
      win.show();
      win.focus();
    } catch {
      // ignore
    }

    const timeoutMs = 45_000;
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
            () =>
              reject(
                new Error(
                  granted
                    ? "Front camera capture timed out after 45s"
                    : this.cameraDeniedMessage()
                )
              ),
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/NotAllowedError|Permission denied|Could not start video|NotReadableError/i.test(message)) {
        throw new Error(this.cameraDeniedMessage());
      }
      if (!granted && /timed out/i.test(message)) {
        throw new Error(this.cameraDeniedMessage());
      }
      throw error instanceof Error ? error : new Error(message);
    } finally {
      if (timer) clearTimeout(timer);
      if (!win.isDestroyed()) win.destroy();
    }
  }
}
