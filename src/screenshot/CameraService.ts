import path from "path";
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

function cameraHtmlPath(): string {
  // dist/screenshot/CameraService.js → ../assets/camera-capture.html
  return path.join(__dirname, "..", "assets", "camera-capture.html");
}

/**
 * One-shot front-camera still via Chromium getUserMedia.
 * Must load a real file:// page — Electron leaves mediaDevices undefined on data: URLs,
 * which also prevents the app from appearing under System Settings → Camera.
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

  getCameraStatus(): string {
    if (process.platform !== "darwin") return "granted";
    try {
      return systemPreferences.getMediaAccessStatus("camera");
    } catch {
      return "unknown";
    }
  }

  async ensureCameraAccess(): Promise<boolean> {
    if (process.platform !== "darwin") return true;

    try {
      let status = systemPreferences.getMediaAccessStatus("camera");
      log.info("Camera TCC status before prompt", { status });

      if (status === "granted") return true;

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
    log.info("Starting camera capture", {
      granted,
      status,
      html: cameraHtmlPath(),
    });

    const quality = Math.min(1, Math.max(0.4, (options.quality ?? 85) / 100));
    const maxWidth = options.maxWidth ?? 1280;

    const win = new BrowserWindow({
      // Visible briefly so macOS can show the Camera TCC prompt for this binary.
      show: true,
      width: 420,
      height: 320,
      title: "Computer Desktop Agent — Camera",
      alwaysOnTop: true,
      skipTaskbar: false,
      focusable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false,
        webSecurity: true,
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
      // file:// is a secure context in Chromium — data: URLs often have no mediaDevices in Electron.
      await win.loadFile(cameraHtmlPath());

      // Confirm the API exists before calling into page JS.
      const hasMedia = await win.webContents.executeJavaScript(
        `Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)`,
        true
      );
      if (!hasMedia) {
        throw new Error(
          "Camera API unavailable (navigator.mediaDevices is undefined). Reinstall the latest DMG."
        );
      }

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
