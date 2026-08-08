import type { ApplicationInfo } from "./types";
import { normalizeAppName } from "./normalize";

/**
 * Sensitive / admin / security utilities must not be opened automatically.
 * Keep this list small — normal GUI apps are allowed via discovery.
 */
const SENSITIVE_APP_PATTERNS: RegExp[] = [
  /^terminal$/i,
  /^iterm$/i,
  /^iterm2$/i,
  /^warp$/i,
  /^kitty$/i,
  /^alacritty$/i,
  /^hyper$/i,
  /^powershell$/i,
  /^windows\s*terminal$/i,
  /^cmd$/i,
  /^command\s*prompt$/i,
  /^disk\s*utility$/i,
  /^keychain\s*access$/i,
  /^registry\s*editor$/i,
  /^regedit$/i,
  /^activity\s*monitor$/i,
  /^console$/i,
  /^script\s*editor$/i,
  /^terminal\.app$/i,
  /^system\s*settings$/i,
  /^system\s*preferences$/i,
  /^directory\s*utility$/i,
  /^migration\s*assistant$/i,
  /^boot\s*camp\s*assistant$/i,
];

export function isSensitiveApplication(app: ApplicationInfo | string): boolean {
  const name = typeof app === "string" ? app : app.name;
  const normalized = normalizeAppName(name);
  return SENSITIVE_APP_PATTERNS.some((re) => re.test(normalized));
}

export function sensitiveBlockReason(name: string): string {
  return `Opening "${name}" is blocked — sensitive system/admin applications require explicit user confirmation`;
}
