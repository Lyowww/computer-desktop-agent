async function render(state) {
  document.getElementById("deviceId").textContent = `Local ID: ${state.deviceId}`;
  const nameInput = document.getElementById("deviceName");
  if (state.deviceName && !nameInput.value) {
    nameInput.value = state.deviceName;
  }

  const status = document.getElementById("status");
  if (state.hasDeviceToken && state.online) {
    status.hidden = false;
    status.textContent = `Connected as “${state.deviceName}”.`;
  } else if (state.hasDeviceToken) {
    status.hidden = false;
    status.textContent = `Credentials saved. Connection: ${state.connectionState}`;
  } else {
    status.hidden = true;
  }
}

async function bootstrap() {
  const [state, config] = await Promise.all([
    window.agentApi.getState(),
    window.agentApi.getConfig(),
  ]);
  if (config?.deviceName) {
    document.getElementById("deviceName").value = config.deviceName;
  }
  render(state);
}

window.agentApi.onState(render);
void bootstrap();

document.getElementById("save").addEventListener("click", async () => {
  const error = document.getElementById("error");
  error.hidden = true;

  const deviceName = document.getElementById("deviceName").value.trim();
  const deviceToken = document.getElementById("token").value.trim();

  if (!deviceName) {
    error.hidden = false;
    error.textContent = "Enter a device name.";
    return;
  }
  if (deviceToken.length < 16) {
    error.hidden = false;
    error.textContent = "Token looks too short. Paste the full device token from the dashboard.";
    return;
  }

  try {
    await window.agentApi.setupCredentials({ deviceName, deviceToken });
    document.getElementById("token").value = "";
    const status = document.getElementById("status");
    status.hidden = false;
    status.textContent = "Saved. Connecting to the backend…";
  } catch (err) {
    error.hidden = false;
    error.textContent = err?.message || String(err);
  }
});
