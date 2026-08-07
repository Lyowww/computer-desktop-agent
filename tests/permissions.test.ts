import { describe, expect, it } from "vitest";
import type { PermissionStatus } from "../src/permissions/PermissionManager";
import { PermissionManager, PermissionAdapter } from "../src/permissions/PermissionManager";

class FakePermissionAdapter implements PermissionAdapter {
  constructor(private readonly status: PermissionStatus) {}

  async check(): Promise<PermissionStatus> {
    return this.status;
  }

  async requestAll(): Promise<PermissionStatus> {
    return this.status;
  }

  async openSystemSettings(): Promise<void> {
    // no-op
  }
}

describe("permission detection", () => {
  it("reports missing accessibility on macOS guidance", async () => {
    const manager = new PermissionManager(
      new FakePermissionAdapter({
        accessibility: false,
        screenRecording: true,
        platform: "darwin",
        processLabel: "Electron",
        guidance: [
          "Grant Accessibility: System Settings → Privacy & Security → Accessibility → enable Electron.",
        ],
      })
    );

    const status = await manager.getStatus();
    expect(status.accessibility).toBe(false);
    expect(status.guidance[0]).toMatch(/Accessibility/);

    await expect(manager.assertReadyForInput()).rejects.toThrow(/Accessibility/);
  });

  it("allows screenshot when screen recording is granted", async () => {
    const manager = new PermissionManager(
      new FakePermissionAdapter({
        accessibility: true,
        screenRecording: true,
        platform: "darwin",
        processLabel: "Electron",
        guidance: [],
      })
    );

    await expect(manager.assertReadyForScreenshot()).resolves.toBeUndefined();
  });
});
