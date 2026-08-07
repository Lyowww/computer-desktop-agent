import { contextBridge, ipcRenderer } from "electron";

export interface AgentBridge {
  getState: () => Promise<unknown>;
  getConfig: () => Promise<unknown>;
  updateConfig: (partial: Record<string, unknown>) => Promise<unknown>;
  setPaused: (paused: boolean) => Promise<boolean>;
  reconnect: () => Promise<boolean>;
  refreshPairingCode: () => Promise<string>;
  copyPairingCode: () => Promise<string>;
  getPermissions: () => Promise<unknown>;
  openPermissionSettings: (kind: "accessibility" | "screenRecording") => Promise<boolean>;
  onState: (cb: (state: unknown) => void) => () => void;
}

const bridge: AgentBridge = {
  getState: () => ipcRenderer.invoke("agent:getState"),
  getConfig: () => ipcRenderer.invoke("agent:getConfig"),
  updateConfig: (partial) => ipcRenderer.invoke("agent:updateConfig", partial),
  setPaused: (paused) => ipcRenderer.invoke("agent:setPaused", paused),
  reconnect: () => ipcRenderer.invoke("agent:reconnect"),
  refreshPairingCode: () => ipcRenderer.invoke("agent:refreshPairingCode"),
  copyPairingCode: () => ipcRenderer.invoke("agent:copyPairingCode"),
  getPermissions: () => ipcRenderer.invoke("agent:getPermissions"),
  openPermissionSettings: (kind) => ipcRenderer.invoke("agent:openPermissionSettings", kind),
  onState: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => cb(state);
    ipcRenderer.on("agent:state", listener);
    return () => ipcRenderer.removeListener("agent:state", listener);
  },
};

contextBridge.exposeInMainWorld("agentApi", bridge);
