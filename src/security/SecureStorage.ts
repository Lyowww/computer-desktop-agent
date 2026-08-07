import { rootLogger } from "../utils/logger";

const log = rootLogger.child("secure-storage");

const SERVICE = "computer-desktop-agent";

/**
 * OS keychain-backed secret storage via keytar when available.
 * Falls back to an in-memory map only for unit tests / unsupported envs.
 */
export class SecureStorage {
  private memoryFallback = new Map<string, string>();
  private keytar: typeof import("keytar") | null | undefined;

  private async getKeytar(): Promise<typeof import("keytar") | null> {
    if (this.keytar !== undefined) {
      return this.keytar;
    }
    try {
      this.keytar = await import("keytar");
      return this.keytar;
    } catch (error) {
      log.warn("keytar unavailable; using memory fallback (secrets will not persist)", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.keytar = null;
      return null;
    }
  }

  async setSecret(account: string, secret: string): Promise<void> {
    const keytar = await this.getKeytar();
    if (keytar) {
      await keytar.setPassword(SERVICE, account, secret);
      return;
    }
    this.memoryFallback.set(account, secret);
  }

  async getSecret(account: string): Promise<string | null> {
    const keytar = await this.getKeytar();
    if (keytar) {
      return keytar.getPassword(SERVICE, account);
    }
    return this.memoryFallback.get(account) ?? null;
  }

  async deleteSecret(account: string): Promise<void> {
    const keytar = await this.getKeytar();
    if (keytar) {
      await keytar.deletePassword(SERVICE, account);
      return;
    }
    this.memoryFallback.delete(account);
  }
}
