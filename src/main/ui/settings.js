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
    ? `Connected · ${state.deviceName} · ${state.deviceId}`
    : `Disconnected · ${state.connectionState} · ${state.deviceId}`;

  const lines = [
    `Token saved: ${state.hasDeviceToken ? "yes" : "no"}`,
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
  const ok = document.getElementById("credOk");
  const err = document.getElementById("credErr");
  ok.hidden = true;
  err.hidden = true;

  const deviceName = document.getElementById("deviceName").value.trim();
  const deviceToken = document.getElementById("deviceToken").value.trim();
  const backendUrl = document.getElementById("backendUrl").value.trim();
  const autoConnect = document.getElementById("autoConnect").checked;

  try {
    await window.agentApi.updateConfig({
      backendUrl,
      deviceName,
      autoConnect,
    });

    if (deviceToken) {
      await window.agentApi.setupCredentials({ deviceName, deviceToken });
      document.getElementById("deviceToken").value = "";
    } else {
      await window.agentApi.reconnect();
    }

    ok.hidden = false;
    ok.textContent = deviceToken
      ? "Device name + token saved. Reconnecting…"
      : "Settings saved. Reconnecting…";
    await load();
  } catch (error) {
    err.hidden = false;
    err.textContent = error?.message || String(error);
  }
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
