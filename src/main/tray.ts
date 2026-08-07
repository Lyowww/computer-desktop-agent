import { Tray, Menu, nativeImage, app } from "electron";
import path from "path";
import type { AgentUiState } from "../agent/Agent";

export interface TrayCallbacks {
  getState: () => AgentUiState;
  onOpenMain: () => void;
  onTakeScreenshot: () => void | Promise<void>;
  onTogglePause: () => void;
  onSettings: () => void;
  onLogs: () => void;
  onReconnect: () => void;
  onGrantPermissions: () => void;
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

  const updateTooltip = (): void => {
    const state = callbacks.getState();
    if (state.online) {
      tray.setToolTip(
        `Computer Desktop Agent\nConnected\n${state.backendUrl || "backend online"}\n${state.deviceName || state.deviceId}`
      );
      return;
    }
    if (state.connectionState === "connecting" || state.connectionState === "reconnecting") {
      tray.setToolTip(`Computer Desktop Agent\n${statusLabel(state)}\n${state.backendUrl || ""}`.trim());
      return;
    }
    tray.setToolTip("Computer Desktop Agent\nDisconnected");
  };

  tray.setToolTip("Computer Desktop Agent");
  tray.on("click", () => callbacks.onOpenMain());
  tray.on("double-click", () => callbacks.onOpenMain());

  const updateMenu = (): void => {
    updateTooltip();
    const state = callbacks.getState();
    const menu = Menu.buildFromTemplate([
      { label: "Computer Agent", enabled: false },
      { type: "separator" },
      { label: statusLabel(state), enabled: false },
      ...(state.online && state.backendUrl
        ? [
            {
              label:
                state.backendUrl.length > 48
                  ? `${state.backendUrl.slice(0, 45)}…`
                  : state.backendUrl,
              enabled: false,
            } as Electron.MenuItemConstructorOptions,
          ]
        : []),
      {
        label: `Device ID: ${state.deviceId.slice(0, 18)}${state.deviceId.length > 18 ? "…" : ""}`,
        enabled: false,
      },
      {
        label: "Open…",
        click: () => callbacks.onOpenMain(),
      },
      ...(state.paired || state.hasDeviceToken
        ? [
            {
              label: "Update device credentials…",
              click: () => callbacks.onShowPairing(),
            } as Electron.MenuItemConstructorOptions,
          ]
        : [
            {
              label: "Setup device (name + token)…",
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
        label: "Logs…",
        click: () => callbacks.onLogs(),
      },
      {
        label: "Grant Permissions…",
        click: () => callbacks.onGrantPermissions(),
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
