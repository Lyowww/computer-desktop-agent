import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { rootLogger } from "../../utils/logger";
import type { ApplicationDiscovery, ApplicationInfo } from "./types";
import { normalizeAppName } from "./normalize";

const execFileAsync = promisify(execFile);
const log = rootLogger.child("app-discovery");

const DEFAULT_CACHE_TTL_MS = 60_000;

function uniqueByPath(apps: ApplicationInfo[]): ApplicationInfo[] {
  const seen = new Set<string>();
  const out: ApplicationInfo[] = [];
  for (const app of apps) {
    const key = path.normalize(app.path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...app, path: key });
  }
  return out;
}

function appInfoFromBundlePath(bundlePath: string): ApplicationInfo | null {
  const normalized = path.normalize(bundlePath);
  if (!normalized.toLowerCase().endsWith(".app")) return null;
  if (!fs.existsSync(normalized)) return null;
  const base = path.basename(normalized, ".app");
  if (!base) return null;
  return { name: base, path: normalized };
}

/**
 * Scan standard macOS application directories for `.app` bundles.
 * Includes one nested level (e.g. /Applications/Utilities/*.app).
 */
export function scanApplicationDirectories(
  roots: string[] = defaultMacSearchRoots(),
): ApplicationInfo[] {
  const found: ApplicationInfo[] = [];

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(root, entry.name);
      if (entry.name.endsWith(".app")) {
        const info = appInfoFromBundlePath(full);
        if (info) found.push(info);
        continue;
      }
      // One nested level for folders like Utilities /
      if (!entry.isDirectory()) continue;
      let nested: fs.Dirent[];
      try {
        nested = fs.readdirSync(full, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of nested) {
        if (!child.name.endsWith(".app")) continue;
        const info = appInfoFromBundlePath(path.join(full, child.name));
        if (info) found.push(info);
      }
    }
  }

  return uniqueByPath(found);
}

export function defaultMacSearchRoots(): string[] {
  const home = os.homedir();
  return [
    "/Applications",
    "/System/Applications",
    "/System/Applications/Utilities",
    "/System/Library/CoreServices",
    path.join(home, "Applications"),
  ];
}

async function mdfindAppsInRoot(root: string): Promise<ApplicationInfo[]> {
  if (!fs.existsSync(root)) return [];
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/mdfind",
      ["-onlyin", root, "kMDItemContentType == 'com.apple.application-bundle'"],
      { timeout: 12_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map(appInfoFromBundlePath)
      .filter((a): a is ApplicationInfo => a !== null);
  } catch (error) {
    log.warn("mdfind discovery failed for root", {
      root,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function mdfindByDisplayName(name: string): Promise<ApplicationInfo[]> {
  const safe = name.replace(/['\\]/g, "");
  if (!safe) return [];
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/mdfind",
      [
        `kMDItemContentType == 'com.apple.application-bundle' && (kMDItemDisplayName == '${safe}'c || kMDItemCFBundleName == '${safe}'c)`,
      ],
      { timeout: 8_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const apps = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map(appInfoFromBundlePath)
      .filter((a): a is ApplicationInfo => a !== null);

    // Prefer apps under standard roots; drop deep random copies.
    const roots = defaultMacSearchRoots().map((r) => path.normalize(r) + path.sep);
    const preferred = apps.filter((app) =>
      roots.some((root) => app.path.startsWith(root) || app.path === root.slice(0, -1)),
    );
    return uniqueByPath(preferred.length > 0 ? preferred : apps);
  } catch {
    return [];
  }
}

export class MacApplicationDiscovery implements ApplicationDiscovery {
  private cache: { apps: ApplicationInfo[]; expiresAt: number } | null = null;

  constructor(private readonly cacheTtlMs = DEFAULT_CACHE_TTL_MS) {}

  clearCache(): void {
    this.cache = null;
  }

  async discoverApplications(): Promise<ApplicationInfo[]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.apps;
    }

    const roots = defaultMacSearchRoots();
    const scanned = scanApplicationDirectories(roots);
    const spotlight: ApplicationInfo[] = [];
    for (const root of ["/Applications", "/System/Applications", path.join(os.homedir(), "Applications")]) {
      spotlight.push(...(await mdfindAppsInRoot(root)));
    }

    const apps = uniqueByPath([...scanned, ...spotlight]).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    this.cache = { apps, expiresAt: now + this.cacheTtlMs };
    log.info("Discovered applications", { count: apps.length });
    return apps;
  }

  async lookupByName(name: string): Promise<ApplicationInfo[]> {
    const normalized = normalizeAppName(name);
    const fromSpotlight = await mdfindByDisplayName(normalized);
    // Also try original casing / display form
    if (name.trim() !== normalized) {
      fromSpotlight.push(...(await mdfindByDisplayName(name.trim().replace(/\.app$/i, ""))));
    }
    return uniqueByPath(fromSpotlight);
  }
}

/** Static inventory used in tests / non-mac platforms when injected. */
export class StaticApplicationDiscovery implements ApplicationDiscovery {
  constructor(private apps: ApplicationInfo[]) {}

  setApps(apps: ApplicationInfo[]): void {
    this.apps = apps;
  }

  async discoverApplications(): Promise<ApplicationInfo[]> {
    return [...this.apps];
  }

  async lookupByName(name: string): Promise<ApplicationInfo[]> {
    const n = normalizeAppName(name);
    return this.apps.filter((app) => normalizeAppName(app.name) === n);
  }
}

export function createApplicationDiscovery(
  platform = process.platform,
): ApplicationDiscovery {
  if (platform === "darwin") {
    return new MacApplicationDiscovery();
  }
  if (platform === "win32") {
    return new WindowsApplicationDiscovery();
  }
  if (platform === "linux") {
    return new LinuxApplicationDiscovery();
  }
  return new StaticApplicationDiscovery([]);
}

/**
 * Probe common install locations (existence-based, not an allowlist gate).
 * Dynamic directory discovery remains macOS-first for PetAI.
 */
export class WindowsApplicationDiscovery implements ApplicationDiscovery {
  async discoverApplications(): Promise<ApplicationInfo[]> {
    const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
    const localAppData = process.env.LOCALAPPDATA ?? "";
    const candidates: ApplicationInfo[] = [
      {
        name: "Google Chrome",
        path: path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      },
      {
        name: "Chrome",
        path: path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      },
      {
        name: "Firefox",
        path: path.join(programFiles, "Mozilla Firefox", "firefox.exe"),
      },
      {
        name: "Visual Studio Code",
        path: path.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"),
      },
      {
        name: "Slack",
        path: path.join(localAppData, "slack", "slack.exe"),
      },
      {
        name: "Discord",
        path: path.join(localAppData, "Discord", "Update.exe"),
      },
      {
        name: "Spotify",
        path: path.join(localAppData, "Microsoft", "WindowsApps", "Spotify.exe"),
      },
    ];
    return uniqueByPath(candidates.filter((c) => fs.existsSync(c.path)));
  }
}

export class LinuxApplicationDiscovery implements ApplicationDiscovery {
  async discoverApplications(): Promise<ApplicationInfo[]> {
    // Prefer .desktop Name= entries under standard application dirs when present.
    const desktopDirs = [
      "/usr/share/applications",
      "/usr/local/share/applications",
      path.join(os.homedir(), ".local/share/applications"),
    ];
    const found: ApplicationInfo[] = [];
    for (const dir of desktopDirs) {
      if (!fs.existsSync(dir)) continue;
      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const file of entries) {
        if (!file.endsWith(".desktop")) continue;
        const full = path.join(dir, file);
        try {
          const content = fs.readFileSync(full, "utf8");
          if (/^NoDisplay\s*=\s*true/m.test(content)) continue;
          if (/^Terminal\s*=\s*true/m.test(content)) continue;
          const nameMatch = content.match(/^Name\s*=\s*(.+)$/m);
          const execMatch = content.match(/^Exec\s*=\s*(.+)$/m);
          if (!nameMatch) continue;
          const name = nameMatch[1].trim();
          const exec = (execMatch?.[1] ?? "")
            .trim()
            .split(/\s+/)[0]
            ?.replace(/%U/g, "")
            .replace(/%u/g, "");
          found.push({
            name,
            path: exec && exec.startsWith("/") ? exec : full,
          });
        } catch {
          // ignore unreadable desktop files
        }
      }
    }
    return uniqueByPath(found);
  }
}
