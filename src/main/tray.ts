import { Tray, Menu, nativeImage, app } from "electron";
import path from "path";
import type { AgentUiState } from "../agent/Agent";

export interface TrayCallbacks {
  getState: () => AgentUiState;
  onTakeScreenshot: () => void | Promise<void>;
  onTogglePause: () => void;
  onSettings: () => void;
  onReconnect: () => void;
  onQuit: () => void;
  onShowPairing: () => void;
}

export interface AppTray {
  tray: Tray;
  updateMenu: () => void;
}

function resolveTrayIcon(): Electron.NativeImage {
  const candidates = [
    path.join(process.resourcesPath, "assets", "trayTemplate.png"),
    path.join(__dirname, "..", "assets", "trayTemplate.png"),
    path.join(app.getAppPath(), "assets", "trayTemplate.png"),
    path.join(app.getAppPath(), "dist", "assets", "trayTemplate.png"),
  ];

  for (const candidate of candidates) {
    const img = nativeImage.createFromPath(candidate);
    if (!img.isEmpty()) {
      img.setTemplateImage(true);
      return img;
    }
  }

  // 16x16 simple black square fallback
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4 + 3] = 255;
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function statusLabel(state: AgentUiState): string {
  if (state.paused) return "○ Paused";
  if (state.online) return "● Connected";
  if (state.connectionState === "reconnecting" || state.connectionState === "connecting") {
    return "◌ Connecting…";
  }
  return "○ Disconnected";
}

export function createTray(callbacks: TrayCallbacks): AppTray {
  const tray = new Tray(resolveTrayIcon());
  tray.setToolTip("Computer Desktop Agent");

  const updateMenu = (): void => {
    const state = callbacks.getState();
    const menu = Menu.buildFromTemplate([
      { label: "Computer Agent", enabled: false },
      { type: "separator" },
      { label: statusLabel(state), enabled: false },
      {
        label: `Device ID: ${state.deviceId.slice(0, 18)}${state.deviceId.length > 18 ? "…" : ""}`,
        enabled: false,
      },
      ...(state.paired || state.hasDeviceToken
        ? []
        : [
            {
              label: "Paste device token…",
              click: () => callbacks.onShowPairing(),
            } as Electron.MenuItemConstructorOptions,
          ]),
      { type: "separator" },
      {
        label: "Take Screenshot",
        click: () => void callbacks.onTakeScreenshot(),
      },
      {
        label: state.paused ? "Resume Agent" : "Pause Agent",
        click: () => callbacks.onTogglePause(),
      },
      {
        label: "Settings",
        click: () => callbacks.onSettings(),
      },
      {
        label: "Reconnect",
        click: () => callbacks.onReconnect(),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => callbacks.onQuit(),
      },
    ]);
    tray.setContextMenu(menu);
  };

  updateMenu();

  return { tray, updateMenu };
}
