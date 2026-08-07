async function render(state) {
  document.getElementById("deviceId").textContent = `Device ID: ${state.deviceId}`;
  const status = document.getElementById("status");
  if (state.hasDeviceToken && state.online) {
    status.hidden = false;
    status.textContent = "Connected and registered with the backend.";
  } else if (state.hasDeviceToken) {
    status.hidden = false;
    status.textContent = `Token saved. Connection: ${state.connectionState}`;
  } else {
    status.hidden = true;
  }
}

window.agentApi.getState().then(render);
window.agentApi.onState(render);

document.getElementById("save").addEventListener("click", async () => {
  const error = document.getElementById("error");
  error.hidden = true;
  const token = document.getElementById("token").value.trim();
  if (token.length < 16) {
    error.hidden = false;
    error.textContent = "Token looks too short. Paste the full device token from the dashboard.";
    return;
  }
  try {
    await window.agentApi.setDeviceToken(token);
    document.getElementById("token").value = "";
    const status = document.getElementById("status");
    status.hidden = false;
    status.textContent = "Token saved securely. Connecting…";
  } catch (err) {
    error.hidden = false;
    error.textContent = err?.message || String(err);
  }
});
