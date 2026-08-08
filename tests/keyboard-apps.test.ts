import { describe, expect, it, vi } from "vitest";
import {
  AmbiguousApplicationError,
  ApplicationNotFoundError,
  ApplicationService,
  SensitiveApplicationError,
  StaticApplicationDiscovery,
  createTestApplicationService,
  normalizeAppName,
  resolveApplicationFromList,
} from "../src/automation/applications/ApplicationService";
import type { ApplicationInfo } from "../src/automation/applications/types";
import { validateKeyNames } from "../src/automation/keyboard/keyNames";

const inventory: ApplicationInfo[] = [
  { name: "Telegram", path: "/Applications/Telegram.app", bundleId: "ru.keepcoder.Telegram" },
  { name: "Discord", path: "/Applications/Discord.app" },
  { name: "Google Chrome", path: "/Applications/Google Chrome.app" },
  { name: "Safari", path: "/System/Applications/Safari.app" },
  { name: "Slack", path: "/Applications/Slack.app" },
  { name: "Visual Studio Code", path: "/Applications/Visual Studio Code.app" },
  { name: "Spotify", path: "/Applications/Spotify.app" },
  { name: "Figma", path: "/Applications/Figma.app" },
  { name: "Terminal", path: "/System/Applications/Utilities/Terminal.app" },
  { name: "Adobe Photoshop", path: "/Applications/Adobe Photoshop.app" },
  { name: "Adobe Illustrator", path: "/Applications/Adobe Illustrator.app" },
  { name: "HelperA", path: "/Applications/Foo Helper.app" },
  { name: "HelperA", path: "/Users/test/Applications/Foo Helper.app" },
];

describe("normalizeAppName", () => {
  it("strips .app and lowercases", () => {
    expect(normalizeAppName("Telegram")).toBe("telegram");
    expect(normalizeAppName("telegram")).toBe("telegram");
    expect(normalizeAppName("TELEGRAM")).toBe("telegram");
    expect(normalizeAppName("Telegram.app")).toBe("telegram");
    expect(normalizeAppName("  Telegram.app  ")).toBe("telegram");
  });
});

describe("resolveApplicationFromList", () => {
  it("finds Telegram exactly", () => {
    const result = resolveApplicationFromList("Telegram", inventory);
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.app.path).toBe("/Applications/Telegram.app");
    }
  });

  it("finds telegram case-insensitively", () => {
    const result = resolveApplicationFromList("telegram", inventory);
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.app.name).toBe("Telegram");
    }
  });

  it("finds Telegram.app via normalization", () => {
    const result = resolveApplicationFromList("Telegram.app", inventory);
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.app.name).toBe("Telegram");
    }
  });

  it("finds Discord", () => {
    const result = resolveApplicationFromList("Discord", inventory);
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.app.path).toBe("/Applications/Discord.app");
    }
  });

  it("resolves Chrome alias to Google Chrome when installed", () => {
    const result = resolveApplicationFromList("Chrome", inventory);
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.app.name).toBe("Google Chrome");
    }
  });

  it("resolves vscode alias to Visual Studio Code", () => {
    const result = resolveApplicationFromList("vscode", inventory);
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.app.name).toBe("Visual Studio Code");
    }
  });

  it("returns not_found for unknown apps — never substitutes", () => {
    const result = resolveApplicationFromList("NotARealAppXYZ", inventory);
    expect(result.status).toBe("not_found");
  });

  it("does not open Telegram Web when Telegram is missing", () => {
    const withoutTelegram = inventory.filter((a) => a.name !== "Telegram");
    withoutTelegram.push({
      name: "Telegram Web",
      path: "/Applications/Telegram Web.app",
    });
    const result = resolveApplicationFromList("Telegram", withoutTelegram);
    expect(result.status).toBe("not_found");
  });

  it("does not open another Adobe app for Photoshop when missing", () => {
    const withoutPs = inventory.filter((a) => a.name !== "Adobe Photoshop");
    const result = resolveApplicationFromList("Photoshop", withoutPs);
    expect(result.status).toBe("not_found");
  });

  it("returns ambiguous when alias matches multiple distinct apps", () => {
    const withBothEditors: ApplicationInfo[] = [
      { name: "Visual Studio Code", path: "/Applications/Visual Studio Code.app" },
      { name: "Code", path: "/Applications/Code.app" },
    ];
    const result = resolveApplicationFromList("vscode", withBothEditors);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates.map((c) => c.name).sort()).toEqual([
        "Code",
        "Visual Studio Code",
      ]);
    }
  });

  it("prefers /Applications when the same name exists twice", () => {
    const result = resolveApplicationFromList("HelperA", inventory);
    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.app.path).toBe("/Applications/Foo Helper.app");
    }
  });

  it("blocks Terminal as sensitive", () => {
    const result = resolveApplicationFromList("Terminal", inventory);
    expect(result.status).toBe("blocked");
  });
});

describe("ApplicationService open flow", () => {
  it("Open Telegram → finds Telegram.app → opens it", async () => {
    const open = vi.fn(async () => undefined);
    const service = createTestApplicationService(inventory, {
      open,
      closeByName: async () => undefined,
    });

    await service.openApplication("Telegram");
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toMatchObject({
      name: "Telegram",
      path: "/Applications/Telegram.app",
    });
  });

  it("Open telegram → finds Telegram.app", async () => {
    const service = createTestApplicationService(inventory);
    const app = await service.findApplication("telegram");
    expect(app?.name).toBe("Telegram");
  });

  it("Open Telegram.app → finds Telegram.app", async () => {
    const service = createTestApplicationService(inventory);
    const app = await service.findApplication("Telegram.app");
    expect(app?.path).toBe("/Applications/Telegram.app");
  });

  it("Open Discord → finds Discord.app", async () => {
    const service = createTestApplicationService(inventory);
    const app = await service.findApplication("Discord");
    expect(app?.path).toBe("/Applications/Discord.app");
  });

  it("unknown application → clear error and never opens another app", async () => {
    const open = vi.fn(async () => undefined);
    const service = createTestApplicationService(inventory, {
      open,
      closeByName: async () => undefined,
    });

    await expect(service.openApplication("Photoshop")).rejects.toBeInstanceOf(
      ApplicationNotFoundError,
    );
    await expect(service.openApplication("Photoshop")).rejects.toThrow(
      'Application "Photoshop" was not found.',
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("ambiguous application name → NEEDS_USER_INPUT", async () => {
    const discovery = new StaticApplicationDiscovery([
      { name: "Visual Studio Code", path: "/Applications/Visual Studio Code.app" },
      { name: "Code", path: "/Applications/Code.app" },
    ]);
    const open = vi.fn(async () => undefined);
    const service = new ApplicationService({
      discovery,
      opener: { open, closeByName: async () => undefined },
    });

    await expect(service.openApplication("vscode")).rejects.toBeInstanceOf(
      AmbiguousApplicationError,
    );
    try {
      await service.openApplication("vscode");
    } catch (error) {
      expect(error).toBeInstanceOf(AmbiguousApplicationError);
      if (error instanceof AmbiguousApplicationError) {
        expect(error.message).toContain("NEEDS_USER_INPUT");
        expect(error.candidates.sort()).toEqual(["Code", "Visual Studio Code"]);
      }
    }
    expect(open).not.toHaveBeenCalled();
  });

  it("sensitive app → blocked", async () => {
    const open = vi.fn(async () => undefined);
    const service = createTestApplicationService(inventory, {
      open,
      closeByName: async () => undefined,
    });
    await expect(service.openApplication("Terminal")).rejects.toBeInstanceOf(
      SensitiveApplicationError,
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("existing apps like Slack and Safari still resolve", async () => {
    const service = createTestApplicationService(inventory);
    expect((await service.findApplication("Slack"))?.name).toBe("Slack");
    expect((await service.findApplication("Safari"))?.name).toBe("Safari");
    expect((await service.findApplication("Spotify"))?.name).toBe("Spotify");
    expect((await service.findApplication("Figma"))?.name).toBe("Figma");
  });

  it("rejects unsafe shell-like queries", async () => {
    const service = createTestApplicationService(inventory);
    await expect(service.openApplication("bash")).rejects.toThrow();
    await expect(service.openApplication("rm -rf /")).rejects.toThrow();
  });
});

describe("keyboard key resolution", () => {
  it("resolves common hotkeys", () => {
    const result = validateKeyNames(["Meta", "C"]);
    expect(result.ok).toBe(true);
  });

  it("rejects malformed keys", () => {
    const result = validateKeyNames(["NotARealKeyXYZ"]);
    expect(result.ok).toBe(false);
  });
});
