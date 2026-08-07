import {
  app,
  dialog,
} from "electron";
import { loadEnv } from "../config/env";
import { configService } from "../config/Config";
import { Agent } from "../agent/Agent";
import { registerIpcHandlers } from "../ipc/handlers";
import { createTray } from "./tray";
import { openPairingWindow, openSettingsWindow, openLogsWindow } from "./windows";
import {
  ensurePermissionsOnStartup,
  promptPermissionsFromTray,
} from "./permissionsOnboarding";
import { rootLogger } from "../utils/logger";
import type { AgentUiState } from "../agent/Agent";

loadEnv();

const log = rootLogger.child("main");

let agent: Agent | null = null;
let trayController: ReturnType<typeof createTray> | null = null;
let uiState: AgentUiState | null = null;

// Packaged apps: never crash the whole process on a transient Socket.IO failure.
process.on("uncaughtException", (error) => {
  log.error("Uncaught exception (kept alive)", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
});
process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection (kept alive)", {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

function showMainUi(): void {
  if (!uiState?.hasDeviceToken) {
    openPairingWindow(getUiState);
  } else {
    openSettingsWindow(getUiState);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another instance is already running — it will open the UI via second-instance.
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainUi();
    if (process.platform === "darwin") {
      app.dock?.show();
    }
  });

  app.whenReady().then(async () => {
    // Keep Dock icon so the app is discoverable (not tray-only / invisible).
    if (process.platform === "darwin") {
      app.dock?.show();
    }

    // Ask for Accessibility + Screen Recording before connecting
    try {
      await ensurePermissionsOnStartup();
    } catch (error) {
      log.warn("Permission onboarding failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    agent = new Agent();
    registerIpcHandlers({
      getAgent: () => agent!,
      openSettings: () => openSettingsWindow(getUiState),
      openPairing: () => openPairingWindow(getUiState),
      openLogs: () => openLogsWindow(),
    });

    await agent.start();
    uiState = await agent.getUiState();

    trayController = createTray({
      getState: getUiState,
      onOpenMain: () => showMainUi(),
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
          const message = error instanceof Error ? error.message : String(error);
          const { response } = await dialog.showMessageBox({
            type: "error",
            title: "Screenshot failed",
            message,
            detail:
              "If this is a permission issue, open System Settings and enable Screen Recording for Computer Desktop Agent, then restart.",
            buttons: ["Grant Permissions…", "OK"],
            defaultId: 0,
          });
          if (response === 0) {
            await promptPermissionsFromTray();
          }
        }
      },
      onTogglePause: () => {
        const next = !agent!.isPaused();
        agent!.setPaused(next);
      },
      onSettings: () => openSettingsWindow(getUiState),
      onLogs: () => openLogsWindow(),
      onReconnect: () => agent!.reconnect(),
      onGrantPermissions: () => {
        void promptPermissionsFromTray();
      },
      onQuit: () => {
        void shutdown();
      },
      onShowPairing: () => openPairingWindow(getUiState),
    });

    agent.on("ui", (state: AgentUiState) => {
      uiState = state;
      trayController?.updateMenu();
    });

    // Always show a window so the user is not stuck with a silent background process.
    showMainUi();

    log.info("Computer Desktop Agent started", {
      deviceId: uiState.deviceId,
      backendUrl: configService.get().backendUrl,
      hasDeviceToken: uiState.hasDeviceToken,
    });
  });

  app.on("activate", () => {
    // macOS Dock click / reopen
    showMainUi();
  });
}

app.on("window-all-closed", () => {
  // Stay alive in the system tray / Dock.
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
      deviceName: "",
      pairingCode: agent?.getPairingCode() ?? "------",
      locked: false,
      hasDeviceToken: false,
      backendUrl: configService.get().backendUrl,
    }
  );
}
