import { contextBridge, ipcRenderer } from "electron";

export interface AgentBridge {
  getState: () => Promise<unknown>;
  getConfig: () => Promise<unknown>;
  updateConfig: (partial: Record<string, unknown>) => Promise<unknown>;
  setPaused: (paused: boolean) => Promise<boolean>;
  reconnect: () => Promise<boolean>;
  refreshPairingCode: () => Promise<string>;
  copyPairingCode: () => Promise<string>;
  setDeviceToken: (token: string) => Promise<boolean>;
  setupCredentials: (payload: {
    deviceName: string;
    deviceToken: string;
  }) => Promise<boolean>;
  setUnlockPassword: (password: string) => Promise<boolean>;
  clearUnlockPassword: () => Promise<boolean>;
  getPermissions: () => Promise<unknown>;
  openPermissionSettings: (kind: "accessibility" | "screenRecording") => Promise<boolean>;
  openLogs: () => Promise<boolean>;
  getLogs: () => Promise<unknown[]>;
  clearLogs: () => Promise<boolean>;
  onState: (cb: (state: unknown) => void) => () => void;
  onLog: (cb: (entry: unknown) => void) => () => void;
}

const bridge: AgentBridge = {
  getState: () => ipcRenderer.invoke("agent:getState"),
  getConfig: () => ipcRenderer.invoke("agent:getConfig"),
  updateConfig: (partial) => ipcRenderer.invoke("agent:updateConfig", partial),
  setPaused: (paused) => ipcRenderer.invoke("agent:setPaused", paused),
  reconnect: () => ipcRenderer.invoke("agent:reconnect"),
  refreshPairingCode: () => ipcRenderer.invoke("agent:refreshPairingCode"),
  copyPairingCode: () => ipcRenderer.invoke("agent:copyPairingCode"),
  setDeviceToken: (token) => ipcRenderer.invoke("agent:setDeviceToken", token),
  setupCredentials: (payload) => ipcRenderer.invoke("agent:setupCredentials", payload),
  setUnlockPassword: (password) => ipcRenderer.invoke("agent:setUnlockPassword", password),
  clearUnlockPassword: () => ipcRenderer.invoke("agent:clearUnlockPassword"),
  getPermissions: () => ipcRenderer.invoke("agent:getPermissions"),
  openPermissionSettings: (kind) => ipcRenderer.invoke("agent:openPermissionSettings", kind),
  openLogs: () => ipcRenderer.invoke("agent:openLogs"),
  getLogs: () => ipcRenderer.invoke("agent:getLogs"),
  clearLogs: () => ipcRenderer.invoke("agent:clearLogs"),
  onState: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => cb(state);
    ipcRenderer.on("agent:state", listener);
    return () => ipcRenderer.removeListener("agent:state", listener);
  },
  onLog: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: unknown) => cb(entry);
    ipcRenderer.on("agent:log", listener);
    return () => ipcRenderer.removeListener("agent:log", listener);
  },
};

contextBridge.exposeInMainWorld("agentApi", bridge);
