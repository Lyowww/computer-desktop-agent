import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { rootLogger } from "../../utils/logger";

const execFileAsync = promisify(execFile);
const log = rootLogger.child("applications");

/**
 * Allowlisted logical app names. Never pass arbitrary user/backend strings to a shell.
 */
export const ALLOWED_APPS = [
  "Chrome",
  "Safari",
  "Firefox",
  "VS Code",
  "Slack",
  "Terminal",
  "Finder",
  "Notes",
  "Calculator",
] as const;

export type AllowedApp = (typeof ALLOWED_APPS)[number];

interface AppResolution {
  /** Absolute path or known app identifier — never a free-form shell command */
  kind: "bundle" | "exe" | "desktop" | "command";
  target: string;
  args?: string[];
}

type PlatformResolvers = Record<AllowedApp, AppResolution | null>;

const MAC_APPS: PlatformResolvers = {
  Chrome: { kind: "bundle", target: "/Applications/Google Chrome.app" },
  Safari: { kind: "bundle", target: "/Applications/Safari.app" },
  Firefox: { kind: "bundle", target: "/Applications/Firefox.app" },
  "VS Code": { kind: "bundle", target: "/Applications/Visual Studio Code.app" },
  Slack: { kind: "bundle", target: "/Applications/Slack.app" },
  Terminal: { kind: "bundle", target: "/System/Applications/Utilities/Terminal.app" },
  Finder: { kind: "bundle", target: "/System/Library/CoreServices/Finder.app" },
  Notes: { kind: "bundle", target: "/System/Applications/Notes.app" },
  Calculator: { kind: "bundle", target: "/System/Applications/Calculator.app" },
};

const WIN_APPS: PlatformResolvers = {
  Chrome: {
    kind: "exe",
    target: path.join(process.env.PROGRAMFILES ?? "C:\\\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  },
  Safari: null,
  Firefox: {
    kind: "exe",
    target: path.join(process.env.PROGRAMFILES ?? "C:\\\\Program Files", "Mozilla Firefox", "firefox.exe"),
  },
  "VS Code": {
    kind: "exe",
    target: path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe"),
  },
  Slack: {
    kind: "exe",
    target: path.join(process.env.LOCALAPPDATA ?? "", "slack", "slack.exe"),
  },
  Terminal: { kind: "command", target: "cmd.exe", args: ["/c", "start", "cmd.exe"] },
  Finder: { kind: "command", target: "explorer.exe" },
  Notes: null,
  Calculator: { kind: "command", target: "calc.exe" },
};

const LINUX_APPS: PlatformResolvers = {
  Chrome: { kind: "command", target: "google-chrome" },
  Safari: null,
  Firefox: { kind: "command", target: "firefox" },
  "VS Code": { kind: "command", target: "code" },
  Slack: { kind: "command", target: "slack" },
  Terminal: { kind: "command", target: "x-terminal-emulator" },
  Finder: { kind: "command", target: "xdg-open", args: [process.env.HOME ?? "/"] },
  Notes: null,
  Calculator: { kind: "command", target: "gnome-calculator" },
};

function normalizeAppName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function resolveAllowedApp(name: string): AllowedApp | null {
  const normalized = normalizeAppName(name);
  const aliases: Record<string, AllowedApp> = {
    chrome: "Chrome",
    "google chrome": "Chrome",
    safari: "Safari",
    firefox: "Firefox",
    "vs code": "VS Code",
    vscode: "VS Code",
    code: "VS Code",
    slack: "Slack",
    terminal: "Terminal",
    finder: "Finder",
    explorer: "Finder",
    notes: "Notes",
    calculator: "Calculator",
    calc: "Calculator",
  };
  return aliases[normalized] ?? null;
}

export interface ApplicationLauncherAdapter {
  open(app: AllowedApp): Promise<void>;
}

class MacApplicationLauncher implements ApplicationLauncherAdapter {
  async open(app: AllowedApp): Promise<void> {
    const resolution = MAC_APPS[app];
    if (!resolution) {
      throw new Error(`${app} is not available on macOS`);
    }
    if (resolution.kind === "bundle") {
      if (!fs.existsSync(resolution.target)) {
        throw new Error(`Application not found: ${resolution.target}`);
      }
      // `open` with explicit .app path — no shell interpolation
      await execFileAsync("/usr/bin/open", ["-a", resolution.target], { timeout: 15_000 });
      return;
    }
    throw new Error(`Unsupported macOS resolution for ${app}`);
  }
}

class WindowsApplicationLauncher implements ApplicationLauncherAdapter {
  async open(app: AllowedApp): Promise<void> {
    const resolution = WIN_APPS[app];
    if (!resolution) {
      throw new Error(`${app} is not available on Windows`);
    }
    if (resolution.kind === "exe") {
      if (!fs.existsSync(resolution.target)) {
        throw new Error(`Application not found: ${resolution.target}`);
      }
      await execFileAsync(resolution.target, resolution.args ?? [], {
        timeout: 15_000,
        windowsHide: true,
      });
      return;
    }
    if (resolution.kind === "command") {
      await execFileAsync(resolution.target, resolution.args ?? [], {
        timeout: 15_000,
        windowsHide: true,
      });
      return;
    }
    throw new Error(`Unsupported Windows resolution for ${app}`);
  }
}

class LinuxApplicationLauncher implements ApplicationLauncherAdapter {
  async open(app: AllowedApp): Promise<void> {
    const resolution = LINUX_APPS[app];
    if (!resolution) {
      throw new Error(`${app} is not available on Linux`);
    }
    if (resolution.kind === "command") {
      await execFileAsync(resolution.target, resolution.args ?? [], { timeout: 15_000 });
      return;
    }
    throw new Error(`Unsupported Linux resolution for ${app}`);
  }
}

export function createApplicationLauncher(platform = process.platform): ApplicationLauncherAdapter {
  if (platform === "darwin") return new MacApplicationLauncher();
  if (platform === "win32") return new WindowsApplicationLauncher();
  return new LinuxApplicationLauncher();
}

export class ApplicationService {
  private readonly launcher: ApplicationLauncherAdapter;

  constructor(launcher = createApplicationLauncher()) {
    this.launcher = launcher;
  }

  async openApp(name: string): Promise<{ app: AllowedApp }> {
    const allowed = resolveAllowedApp(name);
    if (!allowed) {
      throw new Error(
        `Application "${name}" is not in the allowlist. Allowed: ${ALLOWED_APPS.join(", ")}`
      );
    }
    await this.launcher.open(allowed);
    log.info("Opened application", { app: allowed });
    return { app: allowed };
  }
}
