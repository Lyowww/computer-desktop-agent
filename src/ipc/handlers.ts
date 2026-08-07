import { ipcMain, clipboard } from "electron";
import type { Agent } from "../agent/Agent";
import { configService } from "../config/Config";
import { PermissionManager } from "../permissions/PermissionManager";
import { broadcastState } from "../main/windows";

export interface IpcContext {
  getAgent: () => Agent;
  openSettings: () => void;
  openPairing: () => void;
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

  // Push state updates to renderer windows when agent emits ui
  const agent = ctx.getAgent();
  agent.on("ui", (state) => {
    broadcastState(state);
  });
}
