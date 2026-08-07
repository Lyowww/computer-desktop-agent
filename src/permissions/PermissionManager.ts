import { execFile } from "child_process";
import { promisify } from "util";
import { desktopCapturer, systemPreferences } from "electron";
import { rootLogger } from "../utils/logger";

const execFileAsync = promisify(execFile);
const log = rootLogger.child("permissions");

export interface PermissionStatus {
  accessibility: boolean;
  screenRecording: boolean;
  platform: NodeJS.Platform;
  guidance: string[];
  /** Process name the user must enable in System Settings */
  processLabel: string;
}

export interface PermissionAdapter {
  check(): Promise<PermissionStatus>;
  /** Trigger OS prompts where possible, then open Settings for anything still missing. */
  requestAll(): Promise<PermissionStatus>;
  openSystemSettings(kind: "accessibility" | "screenRecording"): Promise<void>;
}

function processLabel(): string {
  // Dev runs as Electron; packaged builds use the product name.
  if (process.defaultApp || /electron/i.test(process.execPath)) {
    return "Electron";
  }
  return "Computer Desktop Agent";
}

class MacPermissionAdapter implements PermissionAdapter {
  async check(): Promise<PermissionStatus> {
    const accessibility = this.checkAccessibility();
    const screenRecording = await this.checkScreenRecording();
    const label = processLabel();
    const guidance: string[] = [];

    if (!accessibility) {
      guidance.push(
        `Grant Accessibility: System Settings → Privacy & Security → Accessibility → enable “${label}” (and leave it on).`
      );
    }
    if (!screenRecording) {
      guidance.push(
        `Grant Screen Recording: System Settings → Privacy & Security → Screen Recording → enable “${label}”, then quit and reopen this app.`
      );
    }

    return {
      accessibility,
      screenRecording,
      platform: "darwin",
      guidance,
      processLabel: label,
    };
  }

  async requestAll(): Promise<PermissionStatus> {
    const label = processLabel();
    log.info("Requesting macOS permissions", { processLabel: label });

    // 1) Accessibility — Electron shows the system prompt when prompt=true
    try {
      systemPreferences.isTrustedAccessibilityClient(true);
    } catch (error) {
      log.warn("Accessibility prompt failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 2) Screen Recording — attempting capture triggers the TCC prompt
    try {
      await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1, height: 1 },
      });
    } catch (error) {
      log.warn("Screen capture prompt/trigger failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Also call CGRequestScreenCaptureAccess via JXA as a second trigger
    try {
      await execFileAsync(
        "/usr/bin/osascript",
        [
          "-l",
          "JavaScript",
          "-e",
          `
            ObjC.import('CoreGraphics');
            if (typeof $.CGRequestScreenCaptureAccess === 'function') {
              $.CGRequestScreenCaptureAccess();
            }
          `,
        ],
        { timeout: 8000 }
      );
    } catch {
      // ignore — Electron desktopCapturer is the primary path
    }

    // Give the user a moment if a system sheet appeared
    await new Promise((r) => setTimeout(r, 400));
    return this.check();
  }

  async openSystemSettings(kind: "accessibility" | "screenRecording"): Promise<void> {
    // Modern macOS URLs (Ventura+)
    const modern =
      kind === "accessibility"
        ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        : "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
    try {
      await execFileAsync("/usr/bin/open", [modern]);
    } catch {
      await execFileAsync("/usr/bin/open", [
        "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension",
      ]);
    }
  }

  private checkAccessibility(): boolean {
    try {
      return systemPreferences.isTrustedAccessibilityClient(false);
    } catch (error) {
      log.warn("Accessibility check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async checkScreenRecording(): Promise<boolean> {
    try {
      const status = systemPreferences.getMediaAccessStatus("screen");
      if (status === "granted") return true;
      if (status === "denied" || status === "restricted") return false;

      // not-determined / unknown — try a tiny capture; success means granted
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 1, height: 1 },
        });
        return sources.length > 0;
      } catch {
        return false;
      }
    } catch (error) {
      log.warn("Screen recording check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

class WindowsPermissionAdapter implements PermissionAdapter {
  async check(): Promise<PermissionStatus> {
    return {
      accessibility: true,
      screenRecording: true,
      platform: "win32",
      guidance: [],
      processLabel: processLabel(),
    };
  }

  async requestAll(): Promise<PermissionStatus> {
    return this.check();
  }

  async openSystemSettings(): Promise<void> {
    await execFileAsync("cmd.exe", ["/c", "start", "ms-settings:privacy"], { windowsHide: true });
  }
}

class LinuxPermissionAdapter implements PermissionAdapter {
  async check(): Promise<PermissionStatus> {
    const guidance: string[] = [];
    if (process.env.XDG_SESSION_TYPE === "wayland") {
      guidance.push(
        "On Wayland, approve screen share / remote desktop portal prompts when asked."
      );
    }
    return {
      accessibility: true,
      screenRecording: true,
      platform: "linux",
      guidance,
      processLabel: processLabel(),
    };
  }

  async requestAll(): Promise<PermissionStatus> {
    return this.check();
  }

  async openSystemSettings(): Promise<void> {
    try {
      await execFileAsync("xdg-open", ["settings://"]);
    } catch {
      log.warn("Could not open Linux settings UI");
    }
  }
}

export function createPermissionAdapter(platform = process.platform): PermissionAdapter {
  if (platform === "darwin") return new MacPermissionAdapter();
  if (platform === "win32") return new WindowsPermissionAdapter();
  return new LinuxPermissionAdapter();
}

export class PermissionManager {
  private readonly adapter: PermissionAdapter;

  constructor(adapter = createPermissionAdapter()) {
    this.adapter = adapter;
  }

  async getStatus(): Promise<PermissionStatus> {
    const status = await this.adapter.check();
    log.info("Permission status", {
      accessibility: status.accessibility,
      screenRecording: status.screenRecording,
      platform: status.platform,
      processLabel: status.processLabel,
    });
    return status;
  }

  async requestAll(): Promise<PermissionStatus> {
    const status = await this.adapter.requestAll();
    log.info("Permission request finished", {
      accessibility: status.accessibility,
      screenRecording: status.screenRecording,
      processLabel: status.processLabel,
    });
    return status;
  }

  async openSettings(kind: "accessibility" | "screenRecording"): Promise<void> {
    await this.adapter.openSystemSettings(kind);
  }

  async assertReadyForInput(): Promise<void> {
    const status = await this.getStatus();
    if (!status.accessibility) {
      throw new Error(
        `Accessibility permission missing for “${status.processLabel}”. ${status.guidance.join(" ")}`.trim()
      );
    }
  }

  async assertReadyForScreenshot(): Promise<void> {
    const status = await this.getStatus();
    if (!status.screenRecording) {
      throw new Error(
        `Screen Recording permission missing for “${status.processLabel}”. ${status.guidance.join(" ")}`.trim()
      );
    }
  }
}
