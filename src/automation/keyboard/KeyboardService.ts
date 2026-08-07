import { keyboard, Key } from "@nut-tree-fork/nut-js";
import { normalizeKeyName, validateKeyNames } from "./keyNames";
import { rootLogger } from "../../utils/logger";

const log = rootLogger.child("keyboard");

const KEY_ALIASES: Record<string, Key> = {
  enter: Key.Enter,
  return: Key.Return,
  tab: Key.Tab,
  escape: Key.Escape,
  esc: Key.Escape,
  space: Key.Space,
  backspace: Key.Backspace,
  delete: Key.Delete,
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
  home: Key.Home,
  end: Key.End,
  pageup: Key.PageUp,
  pagedown: Key.PageDown,
  insert: Key.Insert,
  shift: Key.LeftShift,
  leftshift: Key.LeftShift,
  rightshift: Key.RightShift,
  ctrl: Key.LeftControl,
  control: Key.LeftControl,
  leftcontrol: Key.LeftControl,
  rightcontrol: Key.RightControl,
  alt: Key.LeftAlt,
  option: Key.LeftAlt,
  leftalt: Key.LeftAlt,
  rightalt: Key.RightAlt,
  meta: Key.LeftSuper,
  cmd: Key.LeftSuper,
  command: Key.LeftSuper,
  win: Key.LeftWin,
  super: Key.LeftSuper,
  leftsuper: Key.LeftSuper,
  rightsuper: Key.RightSuper,
  caps: Key.CapsLock,
  capslock: Key.CapsLock,
  f1: Key.F1,
  f2: Key.F2,
  f3: Key.F3,
  f4: Key.F4,
  f5: Key.F5,
  f6: Key.F6,
  f7: Key.F7,
  f8: Key.F8,
  f9: Key.F9,
  f10: Key.F10,
  f11: Key.F11,
  f12: Key.F12,
};

export function resolveKey(name: string): Key {
  const normalized = normalizeKeyName(name);

  if (normalized.length === 1) {
    const ch = normalized.toUpperCase();
    const fromEnum = (Key as unknown as Record<string, Key>)[ch];
    if (fromEnum !== undefined) {
      return fromEnum;
    }
    if (/^[0-9]$/.test(normalized)) {
      const digitKey = (Key as unknown as Record<string, Key>)[`Num${normalized}`];
      if (digitKey !== undefined) return digitKey;
    }
  }

  const alias = KEY_ALIASES[normalized];
  if (alias !== undefined) {
    return alias;
  }

  const direct =
    (Key as unknown as Record<string, Key>)[name] ??
    (Key as unknown as Record<string, Key>)[name.charAt(0).toUpperCase() + name.slice(1)];
  if (direct !== undefined) {
    return direct;
  }

  throw new Error(`Unsupported key: ${name}`);
}

export function validateKeyboardKeys(
  keys: string[]
): { ok: true; resolved: Key[] } | { ok: false; error: string } {
  const basic = validateKeyNames(keys);
  if (!basic.ok) return basic;
  try {
    const resolved = keys.map(resolveKey);
    return { ok: true, resolved };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export class KeyboardService {
  async typeText(text: string): Promise<void> {
    if (!text || typeof text !== "string") {
      throw new Error("text must be a non-empty string");
    }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
      throw new Error("Text contains unsupported control characters");
    }
    keyboard.config.autoDelayMs = 0;
    await keyboard.type(text);
    log.info("Typed text", { length: text.length });
  }

  async keyPress(key: string): Promise<void> {
    const resolved = resolveKey(key);
    keyboard.config.autoDelayMs = 0;
    await keyboard.pressKey(resolved);
    await keyboard.releaseKey(resolved);
    log.info("Pressed key", { key });
  }

  async hotkey(keys: string[]): Promise<void> {
    const check = validateKeyboardKeys(keys);
    if (!check.ok) {
      throw new Error(check.error);
    }
    keyboard.config.autoDelayMs = 0;
    await keyboard.pressKey(...check.resolved);
    await keyboard.releaseKey(...[...check.resolved].reverse());
    log.info("Hotkey pressed", { keys });
  }
}
