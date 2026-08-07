import { dialog, shell, Notification } from "electron";
import { PermissionManager, type PermissionStatus } from "../permissions/PermissionManager";
import { rootLogger } from "../utils/logger";

const log = rootLogger.child("permissions-ui");

/**
 * macOS cannot grant Accessibility / Screen Recording via sudo.
 * This flow triggers system prompts and opens Privacy settings for the user.
 */
export async function ensurePermissionsOnStartup(): Promise<PermissionStatus> {
  const manager = new PermissionManager();

  // Always attempt prompts first (idempotent if already granted)
  let status = await manager.requestAll();

  if (status.accessibility && status.screenRecording) {
    log.info("All required permissions granted", { processLabel: status.processLabel });
    return status;
  }

  const missing: string[] = [];
  if (!status.accessibility) missing.push("Accessibility (mouse & keyboard)");
  if (!status.screenRecording) missing.push("Screen Recording (screenshots)");

  const detail = [
    `Enable these for “${status.processLabel}” in System Settings:`,
    ...missing.map((m) => `• ${m}`),
    "",
    "macOS does not allow sudo (or any app) to bypass these privacy controls.",
    "After enabling Screen Recording, quit and reopen this app.",
    "",
    "When running with npm start, the process name is usually “Electron”.",
  ].join("\n");

  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: "Permissions required",
    message: "Computer Desktop Agent needs macOS privacy permissions",
    detail,
    buttons: [
      "Open Accessibility settings",
      "Open Screen Recording settings",
      "I’ve enabled them — Recheck",
      "Continue anyway",
    ],
    defaultId: 0,
    cancelId: 3,
    noLink: true,
  });

  if (response === 0) {
    await manager.openSettings("accessibility");
  } else if (response === 1) {
    await manager.openSettings("screenRecording");
  } else if (response === 2) {
    status = await manager.requestAll();
    if (!status.accessibility || !status.screenRecording) {
      await dialog.showMessageBox({
        type: "info",
        title: "Still missing permissions",
        message: `Still need access for “${status.processLabel}”`,
        detail: status.guidance.join("\n\n") || "Toggle the permission off/on, then reopen the app.",
        buttons: ["OK"],
      });
    } else {
      await dialog.showMessageBox({
        type: "info",
        title: "Permissions OK",
        message: "Accessibility and Screen Recording look granted.",
        buttons: ["OK"],
      });
    }
  }

  if (Notification.isSupported() && (!status.accessibility || !status.screenRecording)) {
    new Notification({
      title: "Permissions still needed",
      body: `Enable “${status.processLabel}” under Privacy & Security, then restart the agent.`,
    }).show();
  }

  // Offer to open both panes once if anything is still missing
  if (!status.accessibility) {
    await manager.openSettings("accessibility");
  }
  if (!status.screenRecording) {
    // slight delay so first Settings pane can open
    await new Promise((r) => setTimeout(r, 600));
    await manager.openSettings("screenRecording");
  }

  return status;
}

export async function promptPermissionsFromTray(): Promise<void> {
  const manager = new PermissionManager();
  const status = await manager.requestAll();

  if (status.accessibility && status.screenRecording) {
    await dialog.showMessageBox({
      type: "info",
      title: "Permissions",
      message: `All set for “${status.processLabel}”`,
      detail: "Accessibility and Screen Recording are granted.",
      buttons: ["OK"],
    });
    return;
  }

  await ensurePermissionsOnStartup();
  void shell; // keep import used if tree-shaken oddly
}
