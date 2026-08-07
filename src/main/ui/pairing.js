async function render(state) {
  document.getElementById("code").textContent = state.pairingCode || "------";
  document.getElementById("deviceId").textContent = `Device ID: ${state.deviceId}`;
}

window.agentApi.getState().then(render);
window.agentApi.onState(render);

document.getElementById("copy").addEventListener("click", async () => {
  await window.agentApi.copyPairingCode();
});

document.getElementById("refresh").addEventListener("click", async () => {
  const code = await window.agentApi.refreshPairingCode();
  document.getElementById("code").textContent = code;
});
