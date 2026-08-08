import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { rootLogger } from "../../utils/logger";
import {
  AmbiguousApplicationError,
  ApplicationNotFoundError,
  SensitiveApplicationError,
  UnsafeApplicationQueryError,
} from "./errors";
import {
  createApplicationDiscovery,
  StaticApplicationDiscovery,
} from "./discovery";
import { isSafeAppQuery, normalizeAppName } from "./normalize";
import { resolveApplicationFromList } from "./resolve";
import type {
  ApplicationDiscovery,
  ApplicationInfo,
  ApplicationOpener,
  ApplicationResolveResult,
} from "./types";

const execFileAsync = promisify(execFile);
const log = rootLogger.child("applications");

export type { ApplicationInfo, ApplicationResolveResult } from "./types";
export { normalizeAppName, isSafeAppQuery, APP_ALIASES } from "./normalize";
export { resolveApplicationFromList } from "./resolve";
export { isSensitiveApplication } from "./sensitive";
export {
  ApplicationNotFoundError,
  AmbiguousApplicationError,
  SensitiveApplicationError,
  UnsafeApplicationQueryError,
} from "./errors";
export {
  MacApplicationDiscovery,
  StaticApplicationDiscovery,
  scanApplicationDirectories,
  createApplicationDiscovery,
} from "./discovery";

class MacApplicationOpener implements ApplicationOpener {
  async open(app: ApplicationInfo): Promise<void> {
    if (!app.path.toLowerCase().endsWith(".app") || !fs.existsSync(app.path)) {
      throw new ApplicationNotFoundError(app.name);
    }
    // Absolute .app path only — never free-form shell / user strings.
    await execFileAsync("/usr/bin/open", ["-a", app.path], { timeout: 15_000 });
  }

  async closeByName(name: string): Promise<void> {
    const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    await execFileAsync(
      "/usr/bin/osascript",
      ["-e", `tell application "${escaped}" to quit`],
      { timeout: 15_000 },
    );
  }
}

class WindowsApplicationOpener implements ApplicationOpener {
  async open(app: ApplicationInfo): Promise<void> {
    if (!fs.existsSync(app.path)) {
      throw new ApplicationNotFoundError(app.name);
    }
    await execFileAsync(app.path, [], {
      timeout: 15_000,
      windowsHide: true,
    });
  }

  async closeByName(name: string): Promise<void> {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-Process -Name ${JSON.stringify(name)} -ErrorAction SilentlyContinue | Stop-Process`,
      ],
      { timeout: 15_000, windowsHide: true },
    );
  }
}

class LinuxApplicationOpener implements ApplicationOpener {
  async open(app: ApplicationInfo): Promise<void> {
    if (app.path.endsWith(".desktop")) {
      await execFileAsync("gtk-launch", [path.basename(app.path, ".desktop")], {
        timeout: 15_000,
      });
      return;
    }
    await execFileAsync(app.path, [], { timeout: 15_000 });
  }

  async closeByName(name: string): Promise<void> {
    await execFileAsync("pkill", ["-x", name], { timeout: 15_000 });
  }
}

class NoopApplicationOpener implements ApplicationOpener {
  async open(app: ApplicationInfo): Promise<void> {
    throw new Error(
      `Application opening is not supported on this platform for ${app.name}`,
    );
  }

  async closeByName(name: string): Promise<void> {
    throw new Error(
      `Application closing is not supported on this platform for ${name}`,
    );
  }
}

function createApplicationOpener(platform = process.platform): ApplicationOpener {
  if (platform === "darwin") return new MacApplicationOpener();
  if (platform === "win32") return new WindowsApplicationOpener();
  if (platform === "linux") return new LinuxApplicationOpener();
  return new NoopApplicationOpener();
}

export interface ApplicationServiceOptions {
  discovery?: ApplicationDiscovery;
  opener?: ApplicationOpener;
}

/**
 * Resolves and opens installed GUI applications by name.
 * AI / backend only provide `OPEN_APP { app }` — this service owns path resolution.
 */
export class ApplicationService {
  private readonly discovery: ApplicationDiscovery;
  private readonly opener: ApplicationOpener;

  constructor(options: ApplicationServiceOptions = {}) {
    this.discovery = options.discovery ?? createApplicationDiscovery();
    this.opener = options.opener ?? createApplicationOpener();
  }

  async discoverApplications(): Promise<ApplicationInfo[]> {
    return this.discovery.discoverApplications();
  }

  /**
   * Find a single installed application by name.
   * Returns null when not found. Throws AmbiguousApplicationError when ambiguous.
   * Throws SensitiveApplicationError when the match is blocked.
   */
  async findApplication(name: string): Promise<ApplicationInfo | null> {
    const result = await this.resolveApplication(name);
    switch (result.status) {
      case "found":
        return result.app;
      case "not_found":
        return null;
      case "ambiguous":
        throw new AmbiguousApplicationError(
          result.query,
          result.candidates.map((c) => c.name),
        );
      case "blocked":
        throw new SensitiveApplicationError(result.query, result.reason);
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  }

  async resolveApplication(name: string): Promise<ApplicationResolveResult> {
    if (!isSafeAppQuery(name)) {
      throw new UnsafeApplicationQueryError(name);
    }

    const inventory = await this.discoverApplications();
    let result = resolveApplicationFromList(name, inventory);

    if (result.status === "not_found" && this.discovery.lookupByName) {
      const extra = await this.discovery.lookupByName(name);
      if (extra.length > 0) {
        const merged = [...inventory, ...extra];
        result = resolveApplicationFromList(name, merged);
      }
    }

    return result;
  }

  async openApplication(name: string): Promise<void> {
    const app = await this.requireApplication(name);
    await this.opener.open(app);
    log.info("Opened application", { app: app.name, path: app.path });
  }

  /**
   * Backward-compatible wrapper used by ActionExecutor / Agent.
   */
  async openApp(name: string): Promise<{ app: string; path: string }> {
    const app = await this.requireApplication(name);
    await this.opener.open(app);
    log.info("Opened application", { app: app.name, path: app.path });
    return { app: app.name, path: app.path };
  }

  async closeApp(name: string): Promise<{ app: string }> {
    const app = await this.requireApplication(name);
    await this.opener.closeByName(app.name);
    log.info("Closed application", { app: app.name });
    return { app: app.name };
  }

  private async requireApplication(name: string): Promise<ApplicationInfo> {
    const result = await this.resolveApplication(name);
    switch (result.status) {
      case "found":
        return result.app;
      case "not_found":
        throw new ApplicationNotFoundError(result.query);
      case "ambiguous":
        throw new AmbiguousApplicationError(
          result.query,
          result.candidates.map((c) => c.name),
        );
      case "blocked":
        throw new SensitiveApplicationError(result.query, result.reason);
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  }
}

/** @deprecated Use dynamic discovery via ApplicationService instead. */
export const ALLOWED_APPS: readonly string[] = [];

/**
 * @deprecated Prefer ApplicationService.resolveApplication / findApplication.
 * Kept for transitional callers — resolves against an empty allowlist.
 */
export function resolveAllowedApp(_name: string): string | null {
  return null;
}

export function createTestApplicationService(
  apps: ApplicationInfo[],
  opener?: ApplicationOpener,
): ApplicationService {
  return new ApplicationService({
    discovery: new StaticApplicationDiscovery(apps),
    opener: opener ?? {
      open: async () => undefined,
      closeByName: async () => undefined,
    },
  });
}
