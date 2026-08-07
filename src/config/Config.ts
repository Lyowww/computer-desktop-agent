import os from "os";
import { z } from "zod";
import { rootLogger } from "../utils/logger";
import { toSocketIoUrl } from "./env";

const log = rootLogger.child("config");

const ConfigSchema = z.object({
  backendUrl: z
    .string()
    .min(1)
    .default("https://computer-agent-backend.onrender.com/ws")
    .refine((value) => {
      try {
        toSocketIoUrl(value);
        return true;
      } catch {
        return false;
      }
    }, "backendUrl must be a valid ws(s):// or http(s):// URL"),
  deviceName: z.string().min(1).default(os.hostname()),
  autoConnect: z.boolean().default(true),
  paused: z.boolean().default(false),
  reconnectBaseMs: z.number().int().positive().default(1000),
  reconnectMaxMs: z.number().int().positive().default(30_000),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

type StoredConfig = Partial<AppConfig>;

interface ConfigStore {
  store: StoredConfig;
  get<K extends keyof AppConfig>(key: K): AppConfig[K] | undefined;
  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void;
}

function createStore(): ConfigStore {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Store = require("electron-store") as new (opts: {
      name: string;
      defaults: StoredConfig;
    }) => ConfigStore;
    return new Store({
      name: "computer-desktop-agent",
      defaults: ConfigSchema.parse({}),
    });
  } catch {
    log.warn("electron-store unavailable; using in-memory config");
    const memory: StoredConfig = ConfigSchema.parse({});
    return {
      get store() {
        return memory;
      },
      get(key) {
        return memory[key] as AppConfig[typeof key] | undefined;
      },
      set(key, value) {
        (memory as Record<string, unknown>)[key] = value;
      },
    };
  }
}

export class ConfigService {
  private readonly store: ConfigStore;

  constructor(store: ConfigStore = createStore()) {
    this.store = store;
  }

  get(): AppConfig {
    const envUrl = process.env.AGENT_BACKEND_URL;
    const envName = process.env.AGENT_DEVICE_NAME;
    const raw = {
      ...this.store.store,
      ...(envUrl ? { backendUrl: envUrl } : {}),
      ...(envName ? { deviceName: envName } : {}),
    };
    const parsed = ConfigSchema.parse(raw);
    return {
      ...parsed,
      backendUrl: toSocketIoUrl(parsed.backendUrl),
    };
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.store.set(key, value);
  }

  update(partial: Partial<AppConfig>): AppConfig {
    for (const [key, value] of Object.entries(partial)) {
      if (value !== undefined) {
        this.store.set(key as keyof AppConfig, value as never);
      }
    }
    return this.get();
  }
}

export const configService = new ConfigService();
