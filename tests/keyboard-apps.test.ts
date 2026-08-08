import { describe, expect, it } from "vitest";
import { resolveAllowedApp, ALLOWED_APPS } from "../src/automation/applications/ApplicationService";
import { validateKeyNames } from "../src/automation/keyboard/keyNames";

describe("application launcher allowlist", () => {
  it("resolves known aliases", () => {
    expect(resolveAllowedApp("chrome")).toBe("Chrome");
    expect(resolveAllowedApp("Google Chrome")).toBe("Google Chrome");
    expect(resolveAllowedApp("VS Code")).toBe("VS Code");
    expect(resolveAllowedApp("Visual Studio Code")).toBe("Visual Studio Code");
    expect(resolveAllowedApp("vscode")).toBe("VS Code");
  });

  it("rejects unknown apps", () => {
    expect(resolveAllowedApp("bash")).toBeNull();
    expect(resolveAllowedApp("rm -rf /")).toBeNull();
  });

  it("exposes a fixed allowlist", () => {
    expect(ALLOWED_APPS).toContain("Chrome");
    expect(ALLOWED_APPS).toContain("Slack");
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
