import { Notification, BrowserWindow } from "electron";
import { rootLogger } from "../../utils/logger";

const log = rootLogger.child("notify");

export interface DesktopNotifyPayload {
  requestId: string;
  title?: string;
  body: string;
  from?: string;
}

export class NotifyService {
  async show(payload: DesktopNotifyPayload): Promise<{ delivered: boolean }> {
    const title = payload.title?.trim() || "Computer Agent";
    const body = payload.body.trim().slice(0, 2000);
    if (!body) {
      throw new Error("Notification body is required");
    }

    if (Notification.isSupported()) {
      const notification = new Notification({
        title,
        body,
        silent: false,
      });
      notification.show();
      log.info("Showed desktop notification", {
        requestId: payload.requestId,
        length: body.length,
      });
      return { delivered: true };
    }

    // Fallback: small focused window when OS notifications are unavailable
    const win = new BrowserWindow({
      width: 360,
      height: 160,
      resizable: false,
      alwaysOnTop: true,
      title,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    const html = `<!DOCTYPE html><html><body style="font-family:system-ui;padding:16px">
      <h3 style="margin:0 0 8px">${escapeHtml(title)}</h3>
      <p style="margin:0;white-space:pre-wrap">${escapeHtml(body)}</p>
    </body></html>`;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    log.info("Showed fallback notification window", { requestId: payload.requestId });
    return { delivered: true };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
