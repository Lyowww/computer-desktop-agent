async function load() {
  const [state, config, perms] = await Promise.all([
    window.agentApi.getState(),
    window.agentApi.getConfig(),
    window.agentApi.getPermissions(),
  ]);

  document.getElementById("backendUrl").value = config.backendUrl;
  document.getElementById("deviceName").value = config.deviceName;
  document.getElementById("autoConnect").checked = config.autoConnect;

  const banner = document.getElementById("connectionBanner");
  const label = document.getElementById("connectionLabel");
  const detail = document.getElementById("connectionDetail");
  const backendUrl = state.backendUrl || config.backendUrl || "—";

  banner.classList.remove("online", "connecting", "offline");
  if (state.online) {
    banner.classList.add("online");
    label.textContent = "Connected";
    detail.innerHTML =
      `<div><strong>Backend:</strong> ${escapeHtml(backendUrl)}</div>` +
      `<div><strong>Device:</strong> ${escapeHtml(state.deviceName || "—")} · ${escapeHtml(state.deviceId)}</div>` +
      (state.paused ? `<div><strong>Status:</strong> Paused</div>` : "");
  } else if (
    state.connectionState === "connecting" ||
    state.connectionState === "reconnecting"
  ) {
    banner.classList.add("connecting");
    label.textContent =
      state.connectionState === "reconnecting" ? "Reconnecting…" : "Connecting…";
    detail.innerHTML =
      `<div><strong>Backend:</strong> ${escapeHtml(backendUrl)}</div>` +
      `<div><strong>Device:</strong> ${escapeHtml(state.deviceName || "—")} · ${escapeHtml(state.deviceId)}</div>`;
  } else {
    banner.classList.add("offline");
    label.textContent = state.paused ? "Paused · Disconnected" : "Disconnected";
    detail.innerHTML =
      `<div><strong>Backend:</strong> ${escapeHtml(backendUrl)}</div>` +
      `<div><strong>Device:</strong> ${escapeHtml(state.deviceName || "—")} · ${escapeHtml(state.deviceId)}</div>` +
      `<div>Save credentials and reconnect to go online.</div>`;
  }

  const lines = [
    `Token saved: ${state.hasDeviceToken ? "yes" : "no"}`,
    `Accessibility: ${perms.accessibility ? "granted" : "missing"}`,
    `Screen Recording: ${perms.screenRecording ? "granted" : "missing"}`,
    ...(perms.guidance || []),
  ];
  document.getElementById("perms").textContent = lines.join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

document.getElementById("logs").addEventListener("click", async () => {
  await window.agentApi.openLogs();
});

document.getElementById("accessibility").addEventListener("click", async () => {
  await window.agentApi.openPermissionSettings("accessibility");
});

document.getElementById("screen").addEventListener("click", async () => {
  await window.agentApi.openPermissionSettings("screenRecording");
});

void load();
