# Computer Desktop Agent

Secure Electron desktop agent that runs on the user's machine, connects to the **Computer Agent Backend** over WebSocket, and executes only validated local OS actions.

This repository is the **desktop agent only**. It does not include a website, AI model, or backend server.

## Features

- System tray app with connection status, pause, screenshot, settings, reconnect, quit
- Secure device identity + pairing code provisioning (secrets in OS keychain via `keytar`)
- WebSocket client with exponential backoff reconnect (1s → 2s → 4s → 8s → 16s → max 30s)
- Zod-validated actions only — no arbitrary shell or code execution
- Mouse, keyboard, allowlisted app launch, screenshot capture
- Permission manager (Accessibility + Screen Recording on macOS)
- Lock-screen detection — refuses control/capture while locked (`status: LOCKED`)
- Structured local logging with secret/screenshot redaction
- Cross-platform packaging via electron-builder (`.dmg`, `.exe`, `.AppImage`)

## Supported actions

| Type | Description |
|------|-------------|
| `SCREENSHOT` | Capture screen once |
| `CLICK` | Click at `(x, y)` |
| `DOUBLE_CLICK` | Double-click at `(x, y)` |
| `MOVE_MOUSE` | Move cursor |
| `TYPE_TEXT` | Type text |
| `KEY_PRESS` | Press a single key |
| `HOTKEY` | Chord of keys |
| `OPEN_APP` | Launch allowlisted app |
| `WAIT` | Wait up to 60s |

## Requirements

- Node.js 20+
- macOS, Windows, or Linux
- Backend WebSocket endpoint (default `ws://localhost:8080/agent`)

### macOS permissions

Grant in **System Settings → Privacy & Security**:

1. **Accessibility** — mouse/keyboard control
2. **Screen Recording** — screenshots (restart the app after granting)

The agent never bypasses OS permissions or the login/lock screen.

## Setup

```bash
npm install
npm run build
npm start
```

Development (TypeScript watch + Electron):

```bash
npm run dev
```

Environment overrides (optional) — copy `.env.example`:

```bash
AGENT_BACKEND_URL=ws://localhost:8080/agent
AGENT_DEVICE_NAME=My-MacBook
```

## Pairing / device token

For the packaged **DMG** app, enter credentials by hand:

1. Open the dashboard → **Devices → Add device**
2. Copy the one-time `deviceToken`
3. In the desktop app, use **Setup device (name + token)…** (or **Settings**)
4. Type a **device name** and paste the **device token**
5. Click **Save & connect**

The token is stored in the OS keychain. No `.env` file is required for DMG installs.

Optional local-dev overrides:

```env
AGENT_BACKEND_URL=wss://computer-agent-backend.onrender.com
AGENT_DEVICE_NAME=My-MacBook
AGENT_DEVICE_TOKEN=paste-token-here
```

> Note: the dashboard **login JWT** is only for the website. The desktop agent needs the **device token**, not the user session token.

### Action result

```json
{
  "event": "ACTION_RESULT",
  "payload": {
    "actionId": "act_123",
    "success": true,
    "status": "OK"
  }
}
```

Locked desktop:

```json
{
  "event": "ACTION_RESULT",
  "payload": {
    "actionId": "act_123",
    "success": false,
    "status": "LOCKED"
  }
}
```

### Screenshot result

```json
{
  "event": "SCREEN_RESULT",
  "payload": {
    "requestId": "…",
    "width": 1920,
    "height": 1080,
    "format": "png",
    "imageBase64": "…"
  }
}
```

Screenshots are captured **only on request** (`CAPTURE_SCREEN` or `SCREENSHOT` action), never streamed continuously.

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

## Project structure

```
src/
  main/           Electron entry, tray, settings/pairing windows
  agent/          Orchestration + action executor
  websocket/      Client + protocol helpers
  screenshot/     Capture + optional resize/compression
  automation/     mouse / keyboard / applications
  permissions/    OS permission checks + guidance
  security/       Device identity, secure storage, lock detection
  ipc/            Preload bridge + handlers
  config/         Local configuration
  utils/          Logger + Zod schemas
```

## Security guarantees

The agent will **never**:

- execute arbitrary shell commands
- execute arbitrary JavaScript from the backend
- bypass OS security, antivirus, or login/lock screens
- store auth tokens in plaintext when the OS keychain is available
- log passwords, tokens, or screenshot image data

Only predefined, Zod-validated actions are executed. Application launch uses an allowlist with OS-specific path resolution (`execFile`, never shell string interpolation).

## Tests

```bash
npm test
```

Coverage includes action/coordinate/keyboard validation, auth proof + pairing codes, reconnect backoff, screenshot resize, permission detection, and log redaction.

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
- `screenshot-desktop` + `pngjs` for capture/compression
- `ws` + Zod
- `keytar` for secure credential storage
- `electron-builder` for packaging
- Vitest for unit tests

## License

MIT
