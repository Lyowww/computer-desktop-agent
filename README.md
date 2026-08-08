# Computer Desktop Agent

Secure Electron desktop agent that runs on the user's machine, connects to the **Computer Agent Backend** over Socket.IO, and executes only validated local OS actions.

This repository is the **desktop agent only**. It does not include a website, AI model, or backend server. It never uses `OPENROUTER_API_KEY`.

## Features

- System tray app with connection status, pause, screenshot, settings, reconnect, quit
- Device-token authentication (OS keychain via `keytar`) — not user JWT, not OpenRouter
- Socket.IO client on namespace `/ws` with exponential backoff reconnect (1s → 30s)
- Zod-validated allowlisted actions only — no arbitrary shell or code execution
- Mouse, keyboard, allowlisted app launch, screenshot capture
- Screenshot coordinate space ↔ native screen mapping (critical when backend requests `maxWidth: 1280`)
- Permission manager (Accessibility + Screen Recording on macOS)
- Lock-screen detection with optional Keychain unlock password
- Structured local logging with secret / TYPE_TEXT / screenshot redaction
- Cross-platform packaging via electron-builder (`.dmg`, `.exe`, `.AppImage`)

## Supported actions

| Type | Description |
|------|-------------|
| `SCREENSHOT` | Capture screen once |
| `CLICK` | Click at `(x, y)` in screenshot coordinate space |
| `DOUBLE_CLICK` | Double-click at `(x, y)` |
| `MOVE_MOUSE` / `MOVE` | Move cursor |
| `TYPE_TEXT` / `TYPE` | Type text (never passed to shell) |
| `KEY_PRESS` / `KEY` | Press a single key |
| `HOTKEY` | Chord of keys (`["meta","l"]` or `"CMD+L"`) |
| `OPEN_APP` | Launch **allowlisted** app only |
| `WAIT` | Bounded wait (`100`–`10000` ms) |
| `ASK_USER` | Acknowledge (no OS side effect; backend/web prompts the user) |
| `DONE` / `FAIL` | Terminal markers |
| `LOCK_SCREEN` / `UNLOCK_SCREEN` | Lock helpers |

Also accepted for tooling: `RIGHT_CLICK`, `SCROLL`, `DRAG`.

## Requirements

- Node.js 20+
- macOS, Windows, or Linux
- Backend Socket.IO endpoint (local default `http://localhost:3000` → namespace `/ws`)

### macOS permissions

Grant in **System Settings → Privacy & Security**:

1. **Accessibility** — mouse / keyboard control  
2. **Screen Recording** — screenshots (restart the app after granting)  
3. **Camera** (optional) — only if using dashboard camera capture  

The agent never bypasses OS permissions. Missing permissions return a clear user-facing error.

## Local development (full stack)

```text
Terminal 1 — backend (port 3000)
  cd ../computer-agent-backend && npm run start:dev

Terminal 2 — AI planner HTTP adapter (port 4000)
  cd ../ai-computer-agent && npm run start:server

Terminal 3 — desktop agent
  cd ../computer-desktop-agent && npm run dev

Terminal 4 — web app
  cd ../computer-agent-web && npm run dev
```

Backend must point at the AI service:

```env
AI_SERVICE_URL=http://localhost:4000
```

Desktop `.env`:

```env
AGENT_BACKEND_URL=http://localhost:3000
AGENT_DEVICE_NAME=My-MacBook
AGENT_DEVICE_TOKEN=<token from Devices → Add device>
```

## Setup (desktop only)

```bash
npm install
npm run build
npm start
```

Development (TypeScript watch + Electron):

```bash
npm run dev
```

## Pairing / device token

1. Open the dashboard → **Devices → Add device**
2. Copy the one-time `deviceToken`
3. Paste into desktop **Setup** / **Settings**, or set `AGENT_DEVICE_TOKEN` in `.env` for local dev
4. Token is stored in the OS keychain

> The dashboard **login JWT** is only for the website. The desktop agent needs the **device token**.

### WebSocket contract (matches backend)

| Direction | Event |
|-----------|--------|
| Desktop → Backend | `REGISTER_DEVICE` |
| Backend → Desktop | `DEVICE_REGISTERED` |
| Backend → Desktop | `CAPTURE_SCREEN` |
| Desktop → Backend | `SCREEN_RESULT` |
| Backend → Desktop | `EXECUTE_ACTION` |
| Desktop → Backend | `ACTION_RESULT` |

Task lifecycle events (`TASK_START`, `TASK_COMPLETED`, `TASK_FAILED`, …) are web-facing; the desktop agent ignores them.

### Action result

```json
{
  "actionId": "act_123",
  "taskId": "…",
  "success": true,
  "result": { "executedAt": "2026-08-08T20:00:00.000Z" }
}
```

### Screenshot result

```json
{
  "requestId": "…",
  "width": 1280,
  "height": 720,
  "image": "<base64 png>",
  "mimeType": "image/png"
}
```

Returned `width`/`height` define the coordinate system for subsequent mouse actions. The agent scales clicks to native display pixels automatically.

Screenshots are captured **only on request** (`CAPTURE_SCREEN` or `SCREENSHOT` action). After each `ACTION_RESULT`, the **backend** requests the next screenshot — the desktop does not auto-stream.

## Tray menu

```
Computer Agent
────────────
● Connected
Device ID
────────────
Take Screenshot
Pause Agent
Settings
Reconnect
Quit
```

## Security guarantees

The agent will **never**:

- execute arbitrary shell commands received from the backend
- execute arbitrary JavaScript / eval / remote code from the backend
- open non-allowlisted applications
- bypass OS permissions
- store auth tokens or unlock passwords in plaintext when the OS keychain is available
- log passwords, device tokens, OpenRouter keys, or full TYPE_TEXT / screenshot payloads

## Tests

```bash
npm test
```

Coverage includes coordinate scaling, action / keyboard validation, executor routing with mocked nut.js, auth, reconnect backoff, screenshot resize, permissions, and log redaction.

## Packaging

```bash
npm run dist:mac     # .dmg
npm run dist:win     # .exe (NSIS)
npm run dist:linux   # .AppImage
```

Artifacts are written to `release/`.

## Tech stack

- Node.js + TypeScript + Electron
- `@nut-tree-fork/nut-js` (maintained nut.js fork) for input automation
- `screenshot-desktop` + `pngjs` for capture / compression
- `socket.io-client` + Zod
- `keytar` for secure credential storage
- `electron-builder` for packaging
- Vitest for unit tests

## License

MIT
