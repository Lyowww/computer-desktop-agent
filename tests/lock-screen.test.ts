import { describe, expect, it, vi, beforeEach } from "vitest";
import { LockScreenDetector, LockScreenAdapter, LockStatus } from "../src/security/LockScreenDetector";
import { UnlockService } from "../src/security/UnlockService";
import { SecureStorage } from "../src/security/SecureStorage";

class FakeLockAdapter implements LockScreenAdapter {
  constructor(private status: LockStatus) {}
  async getStatus(): Promise<LockStatus> {
    return this.status;
  }
  setStatus(status: LockStatus) {
    this.status = status;
  }
}

describe("lock screen detection", () => {
  it("reports locked when adapter says locked", async () => {
    const detector = new LockScreenDetector(new FakeLockAdapter("LOCKED"));
    expect(await detector.isLocked()).toBe(true);
    expect(await detector.getStatus()).toBe("LOCKED");
  });

  it("reports unlocked when adapter says unlocked", async () => {
    const detector = new LockScreenDetector(new FakeLockAdapter("UNLOCKED"));
    expect(await detector.isLocked()).toBe(false);
  });
});

describe("unlock service password storage", () => {
  beforeEach(() => {
    delete process.env.AGENT_UNLOCK_PASSWORD;
  });

  it("reports no password when keychain is empty", async () => {
    const storage = new SecureStorage();
    await storage.deleteSecret("unlock-password");
    const unlock = new UnlockService(storage, new LockScreenDetector(new FakeLockAdapter("UNLOCKED")));
    expect(await unlock.hasPassword()).toBe(false);
  });

  it("stores and clears unlock password in secure storage", async () => {
    const storage = new SecureStorage();
    const unlock = new UnlockService(storage, new LockScreenDetector(new FakeLockAdapter("UNLOCKED")));
    await unlock.setPassword("test-secret-password");
    expect(await unlock.hasPassword()).toBe(true);
    await unlock.clearPassword();
    expect(await unlock.hasPassword()).toBe(false);
  });

  it("treats AGENT_UNLOCK_PASSWORD env as configured", async () => {
    process.env.AGENT_UNLOCK_PASSWORD = "env-secret";
    const storage = new SecureStorage();
    const unlock = new UnlockService(storage, new LockScreenDetector(new FakeLockAdapter("UNLOCKED")));
    expect(await unlock.hasPassword()).toBe(true);
    delete process.env.AGENT_UNLOCK_PASSWORD;
  });

  it("returns NO_PASSWORD when locked without a stored password", async () => {
    const storage = new SecureStorage();
    await storage.deleteSecret("unlock-password");
    const unlock = new UnlockService(
      storage,
      new LockScreenDetector(new FakeLockAdapter("LOCKED")),
      {
        assertReadyForInput: vi.fn(),
      } as never
    );
    const result = await unlock.ensureUnlocked({ timeoutMs: 200 });
    expect(result).toEqual({ ok: false, reason: "NO_PASSWORD" });
  });

  it("no-ops ensureUnlocked when already unlocked", async () => {
    const unlock = new UnlockService(
      new SecureStorage(),
      new LockScreenDetector(new FakeLockAdapter("UNLOCKED"))
    );
    const result = await unlock.ensureUnlocked();
    expect(result).toEqual({ ok: true, alreadyUnlocked: true });
  });
});
