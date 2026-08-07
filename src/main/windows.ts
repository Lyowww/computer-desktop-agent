import { BrowserWindow, app } from "electron";
import path from "path";
import type { AgentUiState } from "../agent/Agent";

let settingsWindow: BrowserWindow | null = null;
let pairingWindow: BrowserWindow | null = null;

function preloadPath(): string {
  return path.join(__dirname, "..", "ipc", "preload.js");
}

function htmlPath(name: string): string {
  const candidates = [
    path.join(__dirname, "ui", `${name}.html`),
    path.join(app.getAppPath(), "dist", "main", "ui", `${name}.html`),
    path.join(app.getAppPath(), "src", "main", "ui", `${name}.html`),
  ];
  return candidates[0];
}

export function openSettingsWindow(getState: () => AgentUiState): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 420,
    resizable: false,
    title: "Settings — Computer Desktop Agent",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void settingsWindow.loadFile(htmlPath("settings"));
  settingsWindow.webContents.on("did-finish-load", () => {
    settingsWindow?.webContents.send("agent:state", getState());
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

export function openPairingWindow(getState: () => AgentUiState): void {
  if (pairingWindow && !pairingWindow.isDestroyed()) {
    pairingWindow.focus();
    pairingWindow.webContents.send("agent:state", getState());
    return;
  }

  pairingWindow = new BrowserWindow({
    width: 420,
    height: 360,
    resizable: false,
    title: "Pair Device — Computer Desktop Agent",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void pairingWindow.loadFile(htmlPath("pairing"));
  pairingWindow.webContents.on("did-finish-load", () => {
    pairingWindow?.webContents.send("agent:state", getState());
  });
  pairingWindow.on("closed", () => {
    pairingWindow = null;
  });
}

export function broadcastState(state: AgentUiState): void {
  for (const win of [settingsWindow, pairingWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send("agent:state", state);
    }
  }
}
