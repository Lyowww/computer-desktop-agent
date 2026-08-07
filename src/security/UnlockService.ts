import { execFile } from "child_process";
import { promisify } from "util";
import { keyboard, Key, mouse, Button, Point } from "@nut-tree-fork/nut-js";
import { SecureStorage } from "./SecureStorage";
import { LockScreenDetector } from "./LockScreenDetector";
import { PermissionManager } from "../permissions/PermissionManager";
import { rootLogger } from "../utils/logger";

const execFileAsync = promisify(execFile);
const log = rootLogger.child("unlock");

const UNLOCK_PASSWORD_ACCOUNT = "unlock-password";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type UnlockAttemptResult =
  | { ok: true; alreadyUnlocked?: boolean }
  | { ok: false; reason: "NO_PASSWORD" | "STILL_LOCKED" | "PERMISSION" | "ERROR"; error?: string };

/**
 * Optional user-configured unlock: wakes the lock screen and types the
 * Keychain-stored password. Does not bypass OS auth — it uses the same
 * password entry path a human would, via Accessibility.
 */
export class UnlockService {
  constructor(
    private readonly secureStorage = new SecureStorage(),
    private readonly lockScreen = new LockScreenDetector(),
    private readonly permissions = new PermissionManager()
  ) {}

  async hasPassword(): Promise<boolean> {
    const fromEnv = process.env.AGENT_UNLOCK_PASSWORD?.trim();
    if (fromEnv) return true;
    const stored = await this.secureStorage.getSecret(UNLOCK_PASSWORD_ACCOUNT);
    return Boolean(stored);
  }

  async setPassword(password: string): Promise<void> {
    const trimmed = password.trim();
    if (!trimmed) {
      throw new Error("Unlock password cannot be empty");
    }
    await this.secureStorage.setSecret(UNLOCK_PASSWORD_ACCOUNT, trimmed);
    log.info("Unlock password saved to keychain");
  }

  async clearPassword(): Promise<void> {
    await this.secureStorage.deleteSecret(UNLOCK_PASSWORD_ACCOUNT);
    log.info("Unlock password cleared from keychain");
  }

  private async resolvePassword(): Promise<string | null> {
    const fromEnv = process.env.AGENT_UNLOCK_PASSWORD?.trim();
    if (fromEnv) return fromEnv;
    return this.secureStorage.getSecret(UNLOCK_PASSWORD_ACCOUNT);
  }

  /** Show / engage the OS lock screen (macOS Control+Command+Q). */
  async openLockScreen(): Promise<void> {
    await this.permissions.assertReadyForInput();
    const platform = process.platform;

    if (platform === "darwin") {
      try {
        await execFileAsync(
          "osascript",
          ["-e", 'tell application "System Events" to keystroke "q" using {control down, command down}'],
          { timeout: 5000 }
        );
      } catch {
        keyboard.config.autoDelayMs = 0;
        await keyboard.pressKey(Key.LeftControl, Key.LeftSuper, Key.Q);
        await keyboard.releaseKey(Key.Q, Key.LeftSuper, Key.LeftControl);
      }
      log.info("Requested macOS lock screen");
      return;
    }

    if (platform === "win32") {
      await execFileAsync(
        "rundll32.exe",
        ["user32.dll,LockWorkStation"],
        { timeout: 5000 }
      );
      log.info("Requested Windows lock screen");
      return;
    }

    if (platform === "linux") {
      try {
        await execFileAsync("loginctl", ["lock-session"], { timeout: 5000 });
      } catch {
        await execFileAsync(
          "dbus-send",
          [
            "--session",
            "--dest=org.freedesktop.ScreenSaver",
            "--type=method_call",
            "/org/freedesktop/ScreenSaver",
            "org.freedesktop.ScreenSaver.Lock",
          ],
          { timeout: 5000 }
        );
      }
      log.info("Requested Linux lock screen");
      return;
    }

    throw new Error(`Lock screen not supported on ${platform}`);
  }

  /**
   * If the desktop is locked and a password is configured, wake the lock UI,
   * type the password, and press Enter. No-ops when already unlocked.
   */
  async ensureUnlocked(options: { timeoutMs?: number } = {}): Promise<UnlockAttemptResult> {
    const timeoutMs = options.timeoutMs ?? 12_000;

    if (!(await this.lockScreen.isLocked())) {
      return { ok: true, alreadyUnlocked: true };
    }

    const password = await this.resolvePassword();
    if (!password) {
      return { ok: false, reason: "NO_PASSWORD" };
    }

    try {
      await this.permissions.assertReadyForInput();
    } catch (error) {
      return {
        ok: false,
        reason: "PERMISSION",
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      await this.attemptUnlock(password);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!(await this.lockScreen.isLocked())) {
          log.info("Desktop unlocked via stored password");
          return { ok: true };
        }
        await sleep(300);
      }
      return { ok: false, reason: "STILL_LOCKED" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("Unlock attempt failed", { error: message });
      return { ok: false, reason: "ERROR", error: message };
    }
  }

  private async attemptUnlock(password: string): Promise<void> {
    keyboard.config.autoDelayMs = 25;

    // Wake display / dismiss the lock cover so the password field appears.
    await this.nudgeLockUi();
    await sleep(450);
    await this.nudgeLockUi();
    await sleep(350);

    // Clear any partial input, then type password + Enter.
    await keyboard.pressKey(Key.Escape);
    await keyboard.releaseKey(Key.Escape);
    await sleep(200);

    await keyboard.type(password);
    await sleep(120);
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
  }

  private async nudgeLockUi(): Promise<void> {
    try {
      await mouse.setPosition(new Point(40, 40));
      await mouse.click(Button.LEFT);
    } catch {
      // Mouse may be unavailable on some lock screens; key nudge is enough.
    }
    try {
      await keyboard.pressKey(Key.Space);
      await keyboard.releaseKey(Key.Space);
    } catch {
      // ignore
    }
  }
}
