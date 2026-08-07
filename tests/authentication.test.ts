import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "crypto";
import { DeviceProvisioning } from "../src/security/DeviceIdentity";
import { SecureStorage } from "../src/security/SecureStorage";

class MemorySecureStorage extends SecureStorage {
  private mem = new Map<string, string>();

  async setSecret(account: string, secret: string): Promise<void> {
    this.mem.set(account, secret);
  }

  async getSecret(account: string): Promise<string | null> {
    return this.mem.get(account) ?? null;
  }

  async deleteSecret(account: string): Promise<void> {
    this.mem.delete(account);
  }
}

describe("authentication / device provisioning", () => {
  it("creates auth proof without exposing the secret", () => {
    const device = new DeviceProvisioning(new MemorySecureStorage(), {
      get: () => undefined,
      set: () => undefined,
    });
    const secret = randomBytes(32).toString("hex");
    const nonce = "nonce-123";
    const proof = device.createAuthProof(nonce, secret);
    expect(proof).toBe(createHash("sha256").update(`${nonce}:${secret}`).digest("hex"));
    expect(proof).not.toContain(secret);
  });

  it("generates a 6-digit pairing code", () => {
    const device = new DeviceProvisioning(new MemorySecureStorage(), {
      get: () => undefined,
      set: () => undefined,
    });
    const code = device.refreshPairingCode();
    expect(code).toMatch(/^\d{6}$/);
  });
});
