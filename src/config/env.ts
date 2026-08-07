import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { app } from "electron";

/**
 * Load `.env` from the project root (dev) or next to the executable (packaged).
 */
export function loadEnv(): void {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "..", "..", ".env"),
  ];

  try {
    if (app?.isPackaged) {
      candidates.unshift(path.join(path.dirname(process.execPath), ".env"));
    }
  } catch {
    // app may be unavailable outside Electron
  }

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file, override: false });
      return;
    }
  }

  dotenv.config({ override: false });
}

/**
 * Normalize user-provided backend URL to a Socket.IO namespace URL.
 * Accepts ws(s):// or http(s):// and ensures `/ws` path (NestJS namespace).
 */
export function toSocketIoUrl(input: string): string {
  const trimmed = input.trim().replace(/\/$/, "");
  const withProtocol = /^(ws|wss|http|https):\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  const url = new URL(withProtocol);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";

  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/ws";
  }

  return url.toString().replace(/\/$/, "");
}
