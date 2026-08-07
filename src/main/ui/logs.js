/** @typedef {{ id: number; timestamp: string; level: string; message: string; context?: Record<string, unknown> }} LogEntry */

/** @type {LogEntry[]} */
let entries = [];
let paused = false;
let unsub = () => {};
let unsubState = () => {};

const view = document.getElementById("logView");
const countEl = document.getElementById("count");
const levelEl = document.getElementById("level");
const searchEl = document.getElementById("search");
const autoscrollEl = document.getElementById("autoscroll");
const pauseBtn = document.getElementById("pause");
const connectionPill = document.getElementById("connectionPill");
const connectionText = document.getElementById("connectionText");
const connectionUrl = document.getElementById("connectionUrl");

function matches(entry) {
  const level = levelEl.value;
  if (level === "WARN" && entry.level === "INFO") return false;
  if (level === "ERROR" && entry.level !== "ERROR") return false;
  const q = searchEl.value.trim().toLowerCase();
  if (!q) return true;
  const hay = `${entry.message} ${JSON.stringify(entry.context ?? {})}`.toLowerCase();
  return hay.includes(q);
}

function formatEntry(entry) {
  const time = entry.timestamp.replace("T", " ").replace("Z", "");
  const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
  return `<div class="entry ${entry.level}" data-id="${entry.id}">` +
    `<span class="ts">${escapeHtml(time)}</span> ` +
    `<span class="lvl">${entry.level}</span> ` +
    `<span>${escapeHtml(entry.message)}</span>` +
    (ctx ? `<span class="ctx">${escapeHtml(ctx)}</span>` : "") +
    `</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderConnection(state, config) {
  const backendUrl = state?.backendUrl || config?.backendUrl || "";
  connectionPill.classList.toggle("online", Boolean(state?.online));
  if (state?.online) {
    connectionText.textContent = "Connected";
    connectionUrl.hidden = !backendUrl;
    connectionUrl.textContent = backendUrl;
  } else if (
    state?.connectionState === "connecting" ||
    state?.connectionState === "reconnecting"
  ) {
    connectionText.textContent =
      state.connectionState === "reconnecting" ? "Reconnecting…" : "Connecting…";
    connectionUrl.hidden = !backendUrl;
    connectionUrl.textContent = backendUrl;
  } else {
    connectionText.textContent = "Disconnected";
    connectionUrl.hidden = !backendUrl;
    connectionUrl.textContent = backendUrl;
  }
}

function render() {
  const filtered = entries.filter(matches);
  countEl.textContent = `${filtered.length} shown · ${entries.length} total`;
  if (!filtered.length) {
    view.innerHTML = `<div class="empty">${entries.length ? "No logs match this filter." : "Waiting for logs…"}</div>`;
    return;
  }
  const nearBottom = view.scrollHeight - view.scrollTop - view.clientHeight < 40;
  view.innerHTML = filtered.map(formatEntry).join("");
  if (autoscrollEl.checked && nearBottom) {
    view.scrollTop = view.scrollHeight;
  }
}

async function load() {
  const [logs, state, config] = await Promise.all([
    window.agentApi.getLogs(),
    window.agentApi.getState(),
    window.agentApi.getConfig(),
  ]);
  entries = logs || [];
  renderConnection(state, config);
  render();
}

document.getElementById("clear").addEventListener("click", async () => {
  await window.agentApi.clearLogs();
  entries = [];
  render();
});

document.getElementById("copy").addEventListener("click", async () => {
  const text = entries
    .filter(matches)
    .map((e) => {
      const ctx = e.context ? ` ${JSON.stringify(e.context)}` : "";
      return `${e.timestamp} ${e.level} ${e.message}${ctx}`;
    })
    .join("\n");
  await navigator.clipboard.writeText(text || "");
});

pauseBtn.addEventListener("click", () => {
  paused = !paused;
  pauseBtn.textContent = paused ? "Resume" : "Pause";
});

levelEl.addEventListener("change", render);
searchEl.addEventListener("input", render);

unsub = window.agentApi.onLog((entry) => {
  if (paused) return;
  entries.push(entry);
  if (entries.length > 500) entries = entries.slice(entries.length - 500);
  render();
});

unsubState = window.agentApi.onState((state) => {
  void window.agentApi.getConfig().then((config) => {
    renderConnection(state, config);
  });
});

window.addEventListener("beforeunload", () => {
  unsub();
  unsubState();
});

void load();
