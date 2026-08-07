import { execFile } from "child_process";
import { promisify } from "util";
import { rootLogger } from "../utils/logger";

const execFileAsync = promisify(execFile);
const log = rootLogger.child("permissions");

export interface PermissionStatus {
  accessibility: boolean;
  screenRecording: boolean;
  platform: NodeJS.Platform;
  guidance: string[];
}

export interface PermissionAdapter {
  check(): Promise<PermissionStatus>;
  openSystemSettings(kind: "accessibility" | "screenRecording"): Promise<void>;
}

class MacPermissionAdapter implements PermissionAdapter {
  async check(): Promise<PermissionStatus> {
    const accessibility = await this.checkAccessibility();
    const screenRecording = await this.checkScreenRecording();
    const guidance: string[] = [];

    if (!accessibility) {
      guidance.push(
        "Grant Accessibility: System Settings → Privacy & Security → Accessibility → enable Computer Desktop Agent."
      );
    }
    if (!screenRecording) {
      guidance.push(
        "Grant Screen Recording: System Settings → Privacy & Security → Screen Recording → enable Computer Desktop Agent, then restart the app."
      );
    }

    return {
      accessibility,
      screenRecording,
      platform: "darwin",
      guidance,
    };
  }

  async openSystemSettings(kind: "accessibility" | "screenRecording"): Promise<void> {
    const pane =
      kind === "accessibility"
        ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        : "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
    await execFileAsync("/usr/bin/open", [pane]);
  }

  private async checkAccessibility(): Promise<boolean> {
    try {
      // AXIsProcessTrusted via Swift/osascript bridge — best-effort without TCC bypass.
      const script = `
        ObjC.import('ApplicationServices');
        ObjC.import('CoreFoundation');
        const trusted = $.AXIsProcessTrusted();
        trusted ? 'true' : 'false';
      `;
      const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], {
        timeout: 5000,
      });
      return stdout.trim() === "true";
    } catch (error) {
      log.warn("Accessibility check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async checkScreenRecording(): Promise<boolean> {
    try {
      // CGPreflightScreenCaptureAccess when available (macOS 10.15+)
      const script = `
        ObjC.import('CoreGraphics');
        if (typeof $.CGPreflightScreenCaptureAccess === 'function') {
          $.CGPreflightScreenCaptureAccess() ? 'true' : 'false';
        } else {
          'true';
        }
      `;
      const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], {
        timeout: 5000,
      });
      return stdout.trim() === "true";
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
    // Windows does not gate UI automation the same way; report available.
    return {
      accessibility: true,
      screenRecording: true,
      platform: "win32",
      guidance: [],
    };
  }

  async openSystemSettings(): Promise<void> {
    await execFileAsync("cmd.exe", ["/c", "start", "ms-settings:privacy"], { windowsHide: true });
  }
}

class LinuxPermissionAdapter implements PermissionAdapter {
  async check(): Promise<PermissionStatus> {
    const guidance: string[] = [];
    // Wayland may require portal permissions; we cannot bypass them.
    if (process.env.XDG_SESSION_TYPE === "wayland") {
      guidance.push(
        "On Wayland, approve screen share / remote desktop portal prompts when asked. Input control may require an X11 session or compositor permissions."
      );
    }
    return {
      accessibility: true,
      screenRecording: true,
      platform: "linux",
      guidance,
    };
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
        `Accessibility permission missing. ${status.guidance.join(" ")}`.trim()
      );
    }
  }

  async assertReadyForScreenshot(): Promise<void> {
    const status = await this.getStatus();
    if (!status.screenRecording) {
      throw new Error(
        `Screen Recording permission missing. ${status.guidance.join(" ")}`.trim()
      );
    }
  }
}
