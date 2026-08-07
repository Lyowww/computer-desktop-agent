import { describe, expect, it } from "vitest";
import { LockScreenDetector, LockScreenAdapter, LockStatus } from "../src/security/LockScreenDetector";

class FakeLockAdapter implements LockScreenAdapter {
  constructor(private status: LockStatus) {}
  async getStatus(): Promise<LockStatus> {
    return this.status;
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
