/**
 * Pure key-name validation helpers that do not require native automation bindings.
 * Runtime resolution to nut.js Key enums lives in KeyboardService.
 */

const KEY_PATTERN = /^[A-Za-z0-9_+\-.]+$/;

const KNOWN_KEYS = new Set(
  [
    "enter",
    "return",
    "tab",
    "escape",
    "esc",
    "space",
    "backspace",
    "delete",
    "up",
    "down",
    "left",
    "right",
    "arrowup",
    "arrowdown",
    "arrowleft",
    "arrowright",
    "home",
    "end",
    "pageup",
    "pagedown",
    "insert",
    "shift",
    "leftshift",
    "rightshift",
    "ctrl",
    "control",
    "leftcontrol",
    "rightcontrol",
    "alt",
    "option",
    "leftalt",
    "rightalt",
    "meta",
    "cmd",
    "command",
    "win",
    "super",
    "leftsuper",
    "rightsuper",
    "caps",
    "capslock",
    "f1",
    "f2",
    "f3",
    "f4",
    "f5",
    "f6",
    "f7",
    "f8",
    "f9",
    "f10",
    "f11",
    "f12",
    ..."abcdefghijklmnopqrstuvwxyz".split(""),
    ..."0123456789".split(""),
  ].map((k) => k)
);

export function normalizeKeyName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "");
}

export function isSupportedKeyName(name: string): boolean {
  if (!KEY_PATTERN.test(name)) return false;
  const normalized = normalizeKeyName(name);
  if (normalized.length === 1 && /[a-z0-9]/.test(normalized)) return true;
  return KNOWN_KEYS.has(normalized);
}

export function validateKeyNames(
  keys: string[]
): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(keys) || keys.length === 0) {
    return { ok: false, error: "keys must be a non-empty array" };
  }
  if (keys.length > 5) {
    return { ok: false, error: "hotkey supports at most 5 keys" };
  }
  for (const key of keys) {
    if (!isSupportedKeyName(key)) {
      return { ok: false, error: `Unsupported key: ${key}` };
    }
  }
  return { ok: true };
}
