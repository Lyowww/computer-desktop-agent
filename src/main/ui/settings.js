async function load() {
  const [state, config, perms] = await Promise.all([
    window.agentApi.getState(),
    window.agentApi.getConfig(),
    window.agentApi.getPermissions(),
  ]);

  document.getElementById("backendUrl").value = config.backendUrl;
  document.getElementById("deviceName").value = config.deviceName;
  document.getElementById("autoConnect").checked = config.autoConnect;
  document.getElementById("status").textContent = state.online
    ? `Connected · ${state.deviceId}`
    : `Disconnected · ${state.connectionState} · ${state.deviceId}`;

  const lines = [
    `Accessibility: ${perms.accessibility ? "granted" : "missing"}`,
    `Screen Recording: ${perms.screenRecording ? "granted" : "missing"}`,
    ...(perms.guidance || []),
  ];
  document.getElementById("perms").textContent = lines.join("\n");
}

window.agentApi.onState(() => {
  void load();
});

document.getElementById("save").addEventListener("click", async () => {
  await window.agentApi.updateConfig({
    backendUrl: document.getElementById("backendUrl").value.trim(),
    deviceName: document.getElementById("deviceName").value.trim(),
    autoConnect: document.getElementById("autoConnect").checked,
  });
  await window.agentApi.reconnect();
  await load();
});

document.getElementById("reconnect").addEventListener("click", async () => {
  await window.agentApi.reconnect();
});

document.getElementById("accessibility").addEventListener("click", async () => {
  await window.agentApi.openPermissionSettings("accessibility");
});

document.getElementById("screen").addEventListener("click", async () => {
  await window.agentApi.openPermissionSettings("screenRecording");
});

void load();
