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
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    settingsWindow.webContents.send("agent:state", getState());
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 640,
    resizable: true,
    minWidth: 460,
    minHeight: 560,
    show: true,
    title: "Computer Desktop Agent",
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
    if (pairingWindow.isMinimized()) pairingWindow.restore();
    pairingWindow.show();
    pairingWindow.focus();
    pairingWindow.webContents.send("agent:state", getState());
    return;
  }

  pairingWindow = new BrowserWindow({
    width: 460,
    height: 560,
    resizable: false,
    show: true,
    title: "Setup Device — Computer Desktop Agent",
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
