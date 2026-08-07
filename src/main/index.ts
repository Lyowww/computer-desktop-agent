import {
  app,
  dialog,
  Notification,
} from "electron";
import { loadEnv } from "../config/env";
import { Agent } from "../agent/Agent";
import { registerIpcHandlers } from "../ipc/handlers";
import { createTray } from "./tray";
import { openPairingWindow, openSettingsWindow } from "./windows";
import { PermissionManager } from "../permissions/PermissionManager";
import { rootLogger } from "../utils/logger";
import type { AgentUiState } from "../agent/Agent";

loadEnv();

const log = rootLogger.child("main");

let agent: Agent | null = null;
let trayController: ReturnType<typeof createTray> | null = null;
let uiState: AgentUiState | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    if (process.platform === "darwin") {
      app.dock?.hide();
    }

    agent = new Agent();
    registerIpcHandlers({
      getAgent: () => agent!,
      openSettings: () => openSettingsWindow(getUiState),
      openPairing: () => openPairingWindow(getUiState),
    });

    await agent.start();
    uiState = await agent.getUiState();

    trayController = createTray({
      getState: getUiState,
      onTakeScreenshot: async () => {
        try {
          const shot = await agent!.takeLocalScreenshot();
          await dialog.showMessageBox({
            type: "info",
            title: "Screenshot",
            message: `Captured ${shot.width}x${shot.height} PNG`,
            detail:
              "Screenshot captured locally. It is not uploaded unless the backend requests CAPTURE_SCREEN.",
          });
        } catch (error) {
          dialog.showErrorBox(
            "Screenshot failed",
            error instanceof Error ? error.message : String(error)
          );
        }
      },
      onTogglePause: () => {
        const next = !agent!.isPaused();
        agent!.setPaused(next);
      },
      onSettings: () => openSettingsWindow(getUiState),
      onReconnect: () => agent!.reconnect(),
      onQuit: () => {
        void shutdown();
      },
      onShowPairing: () => openPairingWindow(getUiState),
    });

    agent.on("ui", (state: AgentUiState) => {
      uiState = state;
      trayController?.updateMenu();
    });

    if (!uiState.hasDeviceToken) {
      openPairingWindow(getUiState);
      void showPermissionGuidance();
    }

    log.info("Computer Desktop Agent started", {
      deviceId: uiState.deviceId,
      backendUrl: process.env.AGENT_BACKEND_URL,
      hasDeviceToken: uiState.hasDeviceToken,
    });
  });
}

app.on("window-all-closed", () => {
  // Stay alive in the system tray.
});

app.on("before-quit", () => {
  void agent?.stop();
});

async function shutdown(): Promise<void> {
  await agent?.stop();
  app.quit();
}

function getUiState(): AgentUiState {
  return (
    uiState ?? {
      connectionState: "disconnected",
      online: false,
      paused: false,
      paired: false,
      deviceId: agent?.getDeviceId() ?? "unknown",
      pairingCode: agent?.getPairingCode() ?? "------",
      locked: false,
      hasDeviceToken: false,
    }
  );
}

async function showPermissionGuidance(): Promise<void> {
  const permissions = new PermissionManager();
  const status = await permissions.getStatus();
  if (status.guidance.length === 0) return;

  if (Notification.isSupported()) {
    new Notification({
      title: "Permissions required",
      body: status.guidance[0],
    }).show();
  }
}
