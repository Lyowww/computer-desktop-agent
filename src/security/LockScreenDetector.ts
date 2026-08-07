import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import { rootLogger } from "../utils/logger";

const execFileAsync = promisify(execFile);
const log = rootLogger.child("lock-screen");

export type LockStatus = "UNLOCKED" | "LOCKED" | "UNKNOWN";

export interface LockScreenAdapter {
  getStatus(): Promise<LockStatus>;
}

class MacLockScreenAdapter implements LockScreenAdapter {
  async getStatus(): Promise<LockStatus> {
    try {
      // CGSessionCopyCurrentDictionary via python/osascript is fragile;
      // ioreg CGSSession is a common non-bypass check.
      const { stdout } = await execFileAsync("ioreg", ["-n", "Root", "-d", "1"], {
        timeout: 3000,
        maxBuffer: 2 * 1024 * 1024,
      });
      if (/CGSSessionScreenIsLocked"=Yes/i.test(stdout) || /"CGSSessionScreenIsLocked"\s*=\s*Yes/i.test(stdout)) {
        return "LOCKED";
      }
      // Alternative key present on some macOS versions
      if (/ScreenLocked"=Yes/i.test(stdout)) {
        return "LOCKED";
      }
      return "UNLOCKED";
    } catch (error) {
      log.warn("Failed to detect macOS lock state", {
        error: error instanceof Error ? error.message : String(error),
      });
      return "UNKNOWN";
    }
  }
}

class WindowsLockScreenAdapter implements LockScreenAdapter {
  async getStatus(): Promise<LockStatus> {
    try {
      // QueryLogonUI process indicates lock/login screen without bypassing it.
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "(Get-Process LogonUI -ErrorAction SilentlyContinue) -ne $null",
        ],
        { timeout: 5000 }
      );
      const locked = stdout.trim().toLowerCase() === "true";
      return locked ? "LOCKED" : "UNLOCKED";
    } catch (error) {
      log.warn("Failed to detect Windows lock state", {
        error: error instanceof Error ? error.message : String(error),
      });
      return "UNKNOWN";
    }
  }
}

class LinuxLockScreenAdapter implements LockScreenAdapter {
  async getStatus(): Promise<LockStatus> {
    try {
      const { stdout } = await execFileAsync(
        "bash",
        [
          "-c",
          "dbus-send --session --dest=org.freedesktop.ScreenSaver --type=method_call --print-reply /org/freedesktop/ScreenSaver org.freedesktop.ScreenSaver.GetActive 2>/dev/null | grep -q true && echo LOCKED || echo UNLOCKED",
        ],
        { timeout: 5000 }
      );
      const value = stdout.trim();
      if (value === "LOCKED") return "LOCKED";
      if (value === "UNLOCKED") return "UNLOCKED";
      return "UNKNOWN";
    } catch (error) {
      log.warn("Failed to detect Linux lock state", {
        error: error instanceof Error ? error.message : String(error),
      });
      return "UNKNOWN";
    }
  }
}

export function createLockScreenAdapter(platform = process.platform): LockScreenAdapter {
  if (platform === "darwin") return new MacLockScreenAdapter();
  if (platform === "win32") return new WindowsLockScreenAdapter();
  if (platform === "linux") return new LinuxLockScreenAdapter();
  return {
    async getStatus() {
      return "UNKNOWN";
    },
  };
}

export class LockScreenDetector {
  private readonly adapter: LockScreenAdapter;

  constructor(adapter = createLockScreenAdapter()) {
    this.adapter = adapter;
  }

  async isLocked(): Promise<boolean> {
    const status = await this.adapter.getStatus();
    return status === "LOCKED";
  }

  async getStatus(): Promise<LockStatus> {
    return this.adapter.getStatus();
  }

  platformLabel(): string {
    return os.platform();
  }
}
