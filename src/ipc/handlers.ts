import { ipcMain, clipboard, BrowserWindow } from "electron";
import type { Agent } from "../agent/Agent";
import { configService } from "../config/Config";
import { PermissionManager } from "../permissions/PermissionManager";
import { broadcastState, broadcastLog } from "../main/windows";
import { clearLogs, getRecentLogs, onLog } from "../utils/logger";

export interface IpcContext {
  getAgent: () => Agent;
  openSettings: () => void;
  openPairing: () => void;
  openLogs: () => void;
}

export function registerIpcHandlers(ctx: IpcContext): void {
  ipcMain.handle("agent:getState", async () => {
    const state = await ctx.getAgent().getUiState();
    return state;
  });

  ipcMain.handle("agent:getConfig", () => configService.get());

  ipcMain.handle("agent:updateConfig", (_event, partial: Record<string, unknown>) => {
    const next = configService.update(partial as never);
    return next;
  });

  ipcMain.handle("agent:setPaused", (_event, paused: boolean) => {
    ctx.getAgent().setPaused(paused);
    return true;
  });

  ipcMain.handle("agent:reconnect", () => {
    ctx.getAgent().reconnect();
    return true;
  });

  ipcMain.handle("agent:refreshPairingCode", () => {
    return ctx.getAgent().refreshPairingCode();
  });

  ipcMain.handle("agent:copyPairingCode", async () => {
    const code = ctx.getAgent().getPairingCode();
    clipboard.writeText(code);
    return code;
  });

  ipcMain.handle("agent:setDeviceToken", async (_event, token: string) => {
    await ctx.getAgent().setDeviceToken(String(token ?? ""));
    return true;
  });

  ipcMain.handle(
    "agent:setupCredentials",
    async (_event, payload: { deviceName?: string; deviceToken?: string }) => {
      await ctx.getAgent().setupCredentials({
        deviceName: String(payload?.deviceName ?? ""),
        deviceToken: String(payload?.deviceToken ?? ""),
      });
      return true;
    }
  );

  ipcMain.handle("agent:getPermissions", async () => {
    const manager = new PermissionManager();
    return manager.getStatus();
  });

  ipcMain.handle(
    "agent:openPermissionSettings",
    async (_event, kind: "accessibility" | "screenRecording") => {
      const manager = new PermissionManager();
      await manager.openSettings(kind);
      return true;
    }
  );

  ipcMain.handle("agent:openPairing", () => {
    ctx.openPairing();
    return true;
  });

  ipcMain.handle("agent:openLogs", () => {
    ctx.openLogs();
    return true;
  });

  ipcMain.handle("agent:getLogs", () => getRecentLogs());

  ipcMain.handle("agent:clearLogs", () => {
    clearLogs();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("agent:logsCleared");
      }
    }
    return true;
  });

  onLog((entry) => {
    broadcastLog(entry);
  });

  const agent = ctx.getAgent();
  agent.on("ui", (state) => {
    broadcastState(state);
  });
}
