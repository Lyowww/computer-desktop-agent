/**
 * Normalize an application name for comparison.
 * Strips trailing `.app`, collapses whitespace, lowercases.
 */
export function normalizeAppName(name: string): string {
  return name
    .trim()
    .replace(/\.app$/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Reject names that look like paths or shell fragments. */
export function isSafeAppQuery(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 256) return false;
  if (/[\\/;|&$`<>]/.test(trimmed)) return false;
  if (trimmed.includes("..")) return false;
  return /^[A-Za-z0-9][A-Za-z0-9 _.'()-]*$/.test(trimmed);
}

/**
 * Common short names → preferred installed display names.
 * Only applied when the preferred target exists in discovery.
 */
export const APP_ALIASES: Readonly<Record<string, readonly string[]>> = {
  chrome: ["Google Chrome", "Chrome"],
  "google chrome": ["Google Chrome", "Chrome"],
  firefox: ["Firefox"],
  safari: ["Safari"],
  "vs code": ["Visual Studio Code", "Code", "VS Code"],
  "visual studio code": ["Visual Studio Code", "Code"],
  vscode: ["Visual Studio Code", "Code", "VS Code"],
  code: ["Visual Studio Code", "Code"],
  slack: ["Slack"],
  notes: ["Notes"],
  calculator: ["Calculator"],
  calc: ["Calculator"],
  finder: ["Finder"],
  explorer: ["Finder"],
};
