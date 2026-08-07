import { BrowserWindow } from "electron";
import path from "path";
import type { AgentUiState } from "../agent/Agent";

let settingsWindow: BrowserWindow | null = null;
let pairingWindow: BrowserWindow | null = null;
let logsWindow: BrowserWindow | null = null;

function preloadPath(): string {
  return path.join(__dirname, "..", "ipc", "preload.js");
}

function htmlPath(name: string): string {
  return path.join(__dirname, "ui", `${name}.html`);
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

export function openLogsWindow(): void {
  if (logsWindow && !logsWindow.isDestroyed()) {
    if (logsWindow.isMinimized()) logsWindow.restore();
    logsWindow.show();
    logsWindow.focus();
    return;
  }

  logsWindow = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 560,
    minHeight: 360,
    show: true,
    title: "Logs — Computer Desktop Agent",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void logsWindow.loadFile(htmlPath("logs"));
  logsWindow.on("closed", () => {
    logsWindow = null;
  });
}

export function broadcastState(state: AgentUiState): void {
  for (const win of [settingsWindow, pairingWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send("agent:state", state);
    }
  }
}

export function broadcastLog(entry: unknown): void {
  if (logsWindow && !logsWindow.isDestroyed()) {
    logsWindow.webContents.send("agent:log", entry);
  }
}
