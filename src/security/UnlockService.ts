import { execFile, spawn, type ChildProcess } from "child_process";
import { promisify } from "util";
import { keyboard, Key, mouse, Button, Point, screen } from "@nut-tree-fork/nut-js";
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
 * Optional user-configured unlock: wakes a black/asleep display, shows the
 * lock password field, and types the Keychain-stored password.
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
      await execFileAsync("rundll32.exe", ["user32.dll,LockWorkStation"], { timeout: 5000 });
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
   * If the desktop is locked and a password is configured, wake the display,
   * show the password field, type the password, and press Enter.
   */
  async ensureUnlocked(options: { timeoutMs?: number } = {}): Promise<UnlockAttemptResult> {
    const timeoutMs = options.timeoutMs ?? 20_000;

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

    const keepAwake = this.startKeepAwake(45);
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
    } finally {
      keepAwake.stop();
    }
  }

  private startKeepAwake(seconds: number): { stop: () => void } {
    if (process.platform !== "darwin") {
      return { stop() {} };
    }

    let child: ChildProcess | null = null;
    try {
      // -u wakes a black/asleep display; -d keeps it from sleeping mid-typing.
      child = spawn("caffeinate", ["-dimsu", "-t", String(seconds)], {
        stdio: "ignore",
        detached: false,
      });
      child.unref?.();
      log.info("Started display wake / keep-awake", { seconds });
    } catch (error) {
      log.warn("Could not start caffeinate", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      stop() {
        if (!child || child.killed) return;
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      },
    };
  }

  /** Force the panel on even when the Mac shows a black/asleep display. */
  private async wakeDisplay(): Promise<void> {
    if (process.platform === "darwin") {
      try {
        // Declares user activity → wakes display from black/sleep.
        await execFileAsync("caffeinate", ["-u", "-t", "5"], { timeout: 8000 });
      } catch (error) {
        log.warn("caffeinate -u wake failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await sleep(900);
    }

    // Physical mouse motion also wakes most displays.
    try {
      const width = await screen.width();
      const height = await screen.height();
      mouse.config.autoDelayMs = 0;
      await mouse.setPosition(new Point(Math.floor(width / 2), Math.floor(height / 2)));
      await sleep(120);
      await mouse.setPosition(new Point(Math.floor(width / 2) + 12, Math.floor(height / 2) + 8));
    } catch {
      // ignore
    }
  }

  /**
   * macOS lock UI often eats the first keystrokes to dismiss the clock cover.
   * Reveal the password field first, then type.
   */
  private async revealPasswordField(): Promise<void> {
    try {
      const width = await screen.width();
      const height = await screen.height();
      // Password field sits near horizontal center, lower-middle of the lock UI.
      const x = Math.floor(width / 2);
      const y = Math.floor(height * 0.62);
      mouse.config.autoDelayMs = 0;
      await mouse.setPosition(new Point(x, y));
      await sleep(200);
      await mouse.click(Button.LEFT);
      await sleep(350);
      await mouse.click(Button.LEFT);
    } catch {
      // Fall through to key reveal.
    }

    // One throwaway key that macOS consumes to show / focus the password field.
    // Do NOT leave Escape/Space in the buffer as password characters.
    try {
      keyboard.config.autoDelayMs = 0;
      await keyboard.pressKey(Key.Return);
      await keyboard.releaseKey(Key.Return);
    } catch {
      // ignore
    }
    await sleep(500);
  }

  private async attemptUnlock(password: string): Promise<void> {
    log.info("Unlock sequence starting", { passwordLength: password.length });

    await this.wakeDisplay();
    await sleep(700);
    await this.revealPasswordField();
    await sleep(400);

    // Type slowly so lockwindow / Secure Input does not drop characters.
    await this.typePasswordReliably(password);
    await sleep(200);

    keyboard.config.autoDelayMs = 0;
    await keyboard.pressKey(Key.Return);
    await keyboard.releaseKey(Key.Return);
    log.info("Unlock password submitted");
  }

  private async typePasswordReliably(password: string): Promise<void> {
    // Prefer System Events — more reliable against loginwindow than fast CGEvent bursts.
    if (process.platform === "darwin") {
      try {
        await this.typeViaSystemEvents(password);
        return;
      } catch (error) {
        log.warn("System Events keystroke failed; falling back to nut.js", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    keyboard.config.autoDelayMs = 55;
    for (const ch of password) {
      await keyboard.type(ch);
      await sleep(35);
    }
    keyboard.config.autoDelayMs = 0;
  }

  private async typeViaSystemEvents(text: string): Promise<void> {
    const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    await execFileAsync(
      "osascript",
      [
        "-e",
        'tell application "System Events"',
        "-e",
        `keystroke "${escaped}"`,
        "-e",
        "end tell",
      ],
      { timeout: 20_000 }
    );
  }
}
