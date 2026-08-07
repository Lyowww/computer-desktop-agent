import { randomBytes, createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { SecureStorage } from "./SecureStorage";
import { rootLogger } from "../utils/logger";

const log = rootLogger.child("device");

export interface DeviceIdentity {
  deviceId: string;
  pairingCode: string;
  paired: boolean;
  createdAt: string;
}

export interface PublicIdentityStore {
  get(key: "deviceId" | "paired" | "createdAt"): string | boolean | undefined;
  set(key: "deviceId" | "paired" | "createdAt", value: string | boolean): void;
}

class MemoryPublicStore implements PublicIdentityStore {
  private data = new Map<string, string | boolean>();

  get(key: "deviceId" | "paired" | "createdAt"): string | boolean | undefined {
    return this.data.get(key);
  }

  set(key: "deviceId" | "paired" | "createdAt", value: string | boolean): void {
    this.data.set(key, value);
  }
}

function createDefaultPublicStore(): PublicIdentityStore {
  try {
    // Lazy-load electron-store only when running inside Electron / when available.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Store = require("electron-store") as new (opts: {
      name: string;
      defaults: Record<string, unknown>;
    }) => {
      get: (key: string) => unknown;
      set: (key: string, value: unknown) => void;
    };
    const store = new Store({ name: "device-identity", defaults: {} });
    return {
      get(key) {
        return store.get(key) as string | boolean | undefined;
      },
      set(key, value) {
        store.set(key, value);
      },
    };
  } catch {
    log.warn("electron-store unavailable; using in-memory public identity store");
    return new MemoryPublicStore();
  }
}

export class DeviceProvisioning {
  private readonly publicStore: PublicIdentityStore;
  private readonly secureStorage: SecureStorage;
  private pairingCode: string | null = null;

  constructor(
    secureStorage = new SecureStorage(),
    publicStore: PublicIdentityStore = createDefaultPublicStore()
  ) {
    this.secureStorage = secureStorage;
    this.publicStore = publicStore;
  }

  async ensureIdentity(): Promise<DeviceIdentity> {
    let deviceId = this.publicStore.get("deviceId") as string | undefined;
    let createdAt = this.publicStore.get("createdAt") as string | undefined;

    if (!deviceId) {
      deviceId = `dev_${uuidv4()}`;
      createdAt = new Date().toISOString();
      this.publicStore.set("deviceId", deviceId);
      this.publicStore.set("createdAt", createdAt);
      this.publicStore.set("paired", false);

      const deviceSecret = randomBytes(32).toString("hex");
      await this.secureStorage.setSecret("deviceSecret", deviceSecret);
      log.info("Generated new device identity", { deviceId });
    }

    const paired = Boolean(this.publicStore.get("paired"));
    if (!paired) {
      this.pairingCode = this.generatePairingCode();
    }

    return {
      deviceId,
      pairingCode: this.pairingCode ?? "------",
      paired,
      createdAt: createdAt ?? new Date().toISOString(),
    };
  }

  getPairingCode(): string {
    if (!this.pairingCode) {
      this.pairingCode = this.generatePairingCode();
    }
    return this.pairingCode;
  }

  refreshPairingCode(): string {
    this.pairingCode = this.generatePairingCode();
    return this.pairingCode;
  }

  async getAuthMaterial(): Promise<{
    deviceId: string;
    deviceSecret: string;
    deviceToken: string | null;
  }> {
    const deviceId = this.publicStore.get("deviceId") as string | undefined;
    if (!deviceId) {
      throw new Error("Device identity not initialized");
    }
    const deviceSecret = await this.secureStorage.getSecret("deviceSecret");
    if (!deviceSecret) {
      throw new Error("Device secret missing from secure storage");
    }
    const deviceToken = await this.secureStorage.getSecret("deviceToken");
    return { deviceId, deviceSecret, deviceToken };
  }

  async markPaired(deviceToken: string): Promise<void> {
    await this.secureStorage.setSecret("deviceToken", deviceToken);
    this.publicStore.set("paired", true);
    this.pairingCode = null;
    log.info("Device paired successfully");
  }

  async clearPairing(): Promise<void> {
    await this.secureStorage.deleteSecret("deviceToken");
    this.publicStore.set("paired", false);
    this.pairingCode = this.generatePairingCode();
    log.warn("Device pairing cleared");
  }

  isPaired(): boolean {
    return Boolean(this.publicStore.get("paired"));
  }

  getDeviceId(): string | undefined {
    return this.publicStore.get("deviceId") as string | undefined;
  }

  /**
   * Deterministic challenge response for authentication handshake.
   * Never logs the secret or resulting digest contents beyond the hash itself.
   */
  createAuthProof(nonce: string, deviceSecret: string): string {
    return createHash("sha256").update(`${nonce}:${deviceSecret}`).digest("hex");
  }

  private generatePairingCode(): string {
    const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
    return n.toString().padStart(6, "0");
  }
}
