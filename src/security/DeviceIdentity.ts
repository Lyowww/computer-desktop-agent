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
  get(key: "deviceId" | "paired" | "createdAt" | "backendDeviceId"): string | boolean | undefined;
  set(key: "deviceId" | "paired" | "createdAt" | "backendDeviceId", value: string | boolean): void;
}

class MemoryPublicStore implements PublicIdentityStore {
  private data = new Map<string, string | boolean>();

  get(key: "deviceId" | "paired" | "createdAt" | "backendDeviceId"): string | boolean | undefined {
    return this.data.get(key);
  }

  set(key: "deviceId" | "paired" | "createdAt" | "backendDeviceId", value: string | boolean): void {
    this.data.set(key, value);
  }
}

function createDefaultPublicStore(): PublicIdentityStore {
  try {
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
      log.info("Generated new local device identity", { deviceId });
    }

    const paired = Boolean(this.publicStore.get("paired"));
    if (!paired) {
      this.pairingCode = this.generatePairingCode();
    }

    const backendId = this.publicStore.get("backendDeviceId") as string | undefined;
    if (backendId) {
      deviceId = backendId;
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

  async getDeviceToken(): Promise<string | null> {
    return this.secureStorage.getSecret("deviceToken");
  }

  /**
   * Store the one-time device token from the web dashboard (Devices → Add device).
   */
  async setDeviceToken(deviceToken: string): Promise<void> {
    if (!deviceToken || deviceToken.length < 16) {
      throw new Error("Device token must be at least 16 characters");
    }
    await this.secureStorage.setSecret("deviceToken", deviceToken);
    this.publicStore.set("paired", true);
    this.pairingCode = null;
    log.info("Device token stored in secure storage");
  }

  async markPairedWithBackendId(backendDeviceId: string): Promise<void> {
    this.publicStore.set("paired", true);
    this.publicStore.set("backendDeviceId", backendDeviceId);
    this.publicStore.set("deviceId", backendDeviceId);
    this.pairingCode = null;
    log.info("Linked to backend device id", { backendDeviceId });
  }

  /** @deprecated Prefer setDeviceToken from dashboard */
  async markPaired(deviceToken: string): Promise<void> {
    await this.setDeviceToken(deviceToken);
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
    return (
      (this.publicStore.get("backendDeviceId") as string | undefined) ||
      (this.publicStore.get("deviceId") as string | undefined)
    );
  }

  createAuthProof(nonce: string, deviceSecret: string): string {
    return createHash("sha256").update(`${nonce}:${deviceSecret}`).digest("hex");
  }

  private generatePairingCode(): string {
    const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
    return n.toString().padStart(6, "0");
  }
}
