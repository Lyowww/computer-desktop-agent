import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import { rootLogger } from "../../utils/logger";

const execFileAsync = promisify(execFile);
const log = rootLogger.child("device-telemetry");

export interface DeviceSystemInfoPayload {
  hostname?: string;
  username?: string;
  platform?: string;
  platformVersion?: string;
  architecture?: string;
  agentVersion?: string;
  cpu?: {
    model?: string;
    cores?: number;
  };
  memory?: {
    totalBytes?: number;
    availableBytes?: number;
  };
  storage?: Array<{
    name?: string;
    totalBytes?: number;
    availableBytes?: number;
  }>;
  gpu?: {
    name?: string;
    vendor?: string;
    vramBytes?: number;
  };
  displays?: Array<{
    width?: number;
    height?: number;
    scaleFactor?: number;
    primary?: boolean;
  }>;
  uptimeSeconds?: number;
}

export interface DeviceNetworkInfoPayload {
  localIp?: string;
  ipv6?: string;
  interfaceName?: string;
  connectionType?: string;
  latencyMs?: number;
  connectionQuality?: "excellent" | "good" | "fair" | "poor" | "unknown";
}

export interface DeviceTelemetryPayload {
  system?: DeviceSystemInfoPayload;
  network?: DeviceNetworkInfoPayload;
}

function qualityFromLatency(
  latencyMs: number | undefined
): DeviceNetworkInfoPayload["connectionQuality"] {
  if (latencyMs == null || !Number.isFinite(latencyMs)) return "unknown";
  if (latencyMs < 50) return "excellent";
  if (latencyMs < 120) return "good";
  if (latencyMs < 250) return "fair";
  return "poor";
}

function readAgentVersion(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("../../../package.json") as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {
    /* ignore */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as {
      app?: { getVersion?: () => string };
    };
    return electron.app?.getVersion?.();
  } catch {
    return undefined;
  }
}

function readDisplays(): DeviceSystemInfoPayload["displays"] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as {
      screen?: {
        getAllDisplays: () => Array<{
          id: number;
          bounds: { width: number; height: number };
          size: { width: number; height: number };
          scaleFactor: number;
        }>;
        getPrimaryDisplay: () => { id: number };
      };
    };
    const displays = electron.screen?.getAllDisplays?.();
    const primaryId = electron.screen?.getPrimaryDisplay?.()?.id;
    if (!displays?.length) return undefined;
    return displays.map((d) => ({
      width: d.size?.width || d.bounds.width,
      height: d.size?.height || d.bounds.height,
      scaleFactor: d.scaleFactor > 0 ? d.scaleFactor : 1,
      primary: primaryId != null ? d.id === primaryId : undefined,
    }));
  } catch {
    return undefined;
  }
}

function ifacePreference(name: string): number {
  // Prefer primary physical adapters over virtual / tethered ones.
  if (/^en0$/i.test(name) || /^wlan0$/i.test(name) || /^eth0$/i.test(name)) return 0;
  if (/^en\d+$/i.test(name) || /^wlan\d+$/i.test(name) || /^eth\d+$/i.test(name)) return 1;
  return 5;
}

function pickNetworkAddresses(): Pick<
  DeviceNetworkInfoPayload,
  "localIp" | "ipv6" | "interfaceName"
> {
  const ifaces = os.networkInterfaces();
  let best: {
    localIp?: string;
    ipv6?: string;
    interfaceName?: string;
    score: number;
  } = { score: Number.POSITIVE_INFINITY };

  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries) continue;
    if (
      name.startsWith("lo") ||
      name.startsWith("utun") ||
      name.startsWith("awdl") ||
      name.startsWith("llw") ||
      name.startsWith("bridge") ||
      name.startsWith("feth") ||
      name.startsWith("ap") ||
      name.includes("VMware") ||
      name.includes("vEthernet") ||
      name.includes("docker") ||
      name.includes("veth")
    ) {
      continue;
    }
    const score = ifacePreference(name);
    for (const entry of entries) {
      if (entry.internal) continue;
      const family = String(entry.family);
      if (family === "IPv4" || family === "4") {
        if (!best.localIp || score < best.score) {
          best = {
            ...best,
            localIp: entry.address,
            interfaceName: name,
            score,
          };
        }
      }
      if (family === "IPv6" || family === "6") {
        if (!entry.address.startsWith("fe80")) {
          if (!best.ipv6 || score <= best.score) {
            best = {
              ...best,
              ipv6: entry.address,
              interfaceName: best.interfaceName ?? name,
              score: Math.min(best.score, score),
            };
          }
        }
      }
    }
  }
  return {
    localIp: best.localIp,
    ipv6: best.ipv6,
    interfaceName: best.interfaceName,
  };
}

async function readPlatformVersion(): Promise<string | undefined> {
  try {
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync("sw_vers", ["-productVersion"], {
        timeout: 3_000,
      });
      const version = stdout.trim();
      if (version) return version;
    }
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "(Get-CimInstance Win32_OperatingSystem).Caption",
        ],
        { timeout: 5_000, windowsHide: true }
      );
      const version = stdout.trim();
      if (version) return version;
    }
  } catch (err) {
    log.warn("Platform version lookup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return os.release() || undefined;
}

async function readDefaultInterface(): Promise<string | undefined> {
  try {
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync("route", ["-n", "get", "default"], {
        timeout: 3_000,
      });
      const match = /interface:\s*(\S+)/i.exec(stdout);
      return match?.[1];
    }
    if (process.platform === "linux") {
      const { stdout } = await execFileAsync(
        "ip",
        ["route", "show", "default"],
        { timeout: 3_000 }
      );
      const match = /\bdev\s+(\S+)/i.exec(stdout);
      return match?.[1];
    }
  } catch {
    /* optional */
  }
  return undefined;
}

async function readConnectionType(
  interfaceName?: string
): Promise<string | undefined> {
  try {
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync(
        "networksetup",
        ["-listallhardwareports"],
        { timeout: 5_000 }
      );
      const blocks = stdout.split(/\n\n+/);
      const classify = (port: string): string | undefined => {
        const lower = port.toLowerCase();
        if (
          lower.includes("wi-fi") ||
          lower.includes("wifi") ||
          lower.includes("airport")
        ) {
          return "wifi";
        }
        if (
          lower.includes("ethernet") ||
          lower.includes("lan") ||
          lower.includes("thunderbolt")
        ) {
          return "ethernet";
        }
        if (lower.includes("usb")) return "usb";
        return undefined;
      };

      // Prefer exact device match
      for (const block of blocks) {
        const device = /Device:\s*(\S+)/i.exec(block)?.[1];
        const port = /Hardware Port:\s*(.+)/i.exec(block)?.[1]?.trim();
        if (!device || !port || !interfaceName || device !== interfaceName) {
          continue;
        }
        return classify(port) || port;
      }

      // Otherwise classify any Wi-Fi / Ethernet hardware that is present
      for (const block of blocks) {
        const port = /Hardware Port:\s*(.+)/i.exec(block)?.[1]?.trim();
        if (!port) continue;
        const kind = classify(port);
        if (kind) return kind;
      }

      if (interfaceName?.startsWith("en")) {
        return "wifi";
      }
    }

    if (process.platform === "linux" && interfaceName) {
      try {
        const { stdout } = await execFileAsync(
          "nmcli",
          ["-t", "-f", "TYPE,DEVICE", "device", "status"],
          { timeout: 3_000 }
        );
        for (const line of stdout.split("\n")) {
          const [type, device] = line.trim().split(":");
          if (device === interfaceName && type) {
            if (type === "wifi") return "wifi";
            if (type === "ethernet") return "ethernet";
            return type;
          }
        }
      } catch {
        /* nmcli optional */
      }
      if (interfaceName.startsWith("wl")) return "wifi";
      if (interfaceName.startsWith("en") || interfaceName.startsWith("eth")) {
        return "ethernet";
      }
    }

    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1 -ExpandProperty InterfaceDescription",
        ],
        { timeout: 5_000, windowsHide: true }
      );
      const desc = stdout.trim().toLowerCase();
      if (!desc) return undefined;
      if (
        desc.includes("wi-fi") ||
        desc.includes("wireless") ||
        desc.includes("wlan")
      ) {
        return "wifi";
      }
      if (desc.includes("ethernet") || desc.includes("gigabit")) {
        return "ethernet";
      }
      return "unknown";
    }
  } catch (err) {
    log.warn("Connection type lookup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return undefined;
}

async function readStorage(): Promise<DeviceSystemInfoPayload["storage"]> {
  try {
    if (process.platform === "darwin" || process.platform === "linux") {
      const { stdout } = await execFileAsync("df", ["-kP"], {
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
      });
      const lines = stdout.trim().split("\n").slice(1);
      const rows: NonNullable<DeviceSystemInfoPayload["storage"]> = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) continue;
        const totalKb = Number(parts[1]);
        const availableKb = Number(parts[3]);
        const mount = parts[parts.length - 1];
        if (
          !mount ||
          mount.startsWith("/dev") ||
          mount.startsWith("/sys") ||
          mount.startsWith("/proc") ||
          mount.startsWith("/run") ||
          mount === "/dev" ||
          totalKb < 1_000_000
        ) {
          continue;
        }
        // Prefer user-facing volumes on macOS APFS
        if (
          process.platform === "darwin" &&
          mount.startsWith("/System/Volumes/") &&
          mount !== "/System/Volumes/Data"
        ) {
          continue;
        }
        if (
          mount.includes("/CoreSimulator/") ||
          mount.includes("/Cryptex/") ||
          mount.startsWith("/Volumes/com.apple.")
        ) {
          continue;
        }
        rows.push({
          name: mount,
          totalBytes: Math.round(totalKb * 1024),
          availableBytes: Math.round(availableKb * 1024),
        });
        if (rows.length >= 8) break;
      }
      // Prefer Data volume first on macOS
      rows.sort((a, b) => {
        const score = (name?: string) =>
          name === "/System/Volumes/Data" ? 0 : name === "/" ? 1 : 2;
        return score(a.name) - score(b.name);
      });
      return rows.length ? rows : undefined;
    }

    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } | ForEach-Object { \"$($_.DeviceID)|$($_.Size)|$($_.FreeSpace)\" }",
        ],
        { timeout: 8_000, windowsHide: true }
      );
      const rows = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, total, free] = line.split("|");
          return {
            name,
            totalBytes: Number(total) || undefined,
            availableBytes: Number(free) || undefined,
          };
        })
        .filter((r) => r.name);
      return rows.length ? rows : undefined;
    }
  } catch (err) {
    log.warn("Storage enumeration failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return undefined;
}

async function readGpu(): Promise<DeviceSystemInfoPayload["gpu"]> {
  try {
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync(
        "system_profiler",
        ["SPDisplaysDataType", "-json"],
        { timeout: 8_000, maxBuffer: 2 * 1024 * 1024 }
      );
      const parsed = JSON.parse(stdout) as {
        SPDisplaysDataType?: Array<{
          sppci_model?: string;
          sppci_vendor?: string;
          spdisplays_vram?: string;
          _name?: string;
          sppci_cores?: string;
        }>;
      };
      const gpu = parsed.SPDisplaysDataType?.[0];
      if (!gpu) return undefined;
      const name = gpu.sppci_model || gpu._name;
      if (!name) return undefined;
      return {
        name,
        vendor: gpu.sppci_vendor || undefined,
      };
    }

    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_VideoController | Select-Object -First 1 | ForEach-Object { \"$($_.Name)|$($_.AdapterRAM)\" }",
        ],
        { timeout: 8_000, windowsHide: true }
      );
      const line = stdout.trim().split("\n")[0]?.trim();
      if (!line) return undefined;
      const [name, vram] = line.split("|");
      const vramBytes = Number(vram);
      return {
        name: name || undefined,
        vramBytes:
          Number.isFinite(vramBytes) && vramBytes > 0 ? vramBytes : undefined,
      };
    }

    if (process.platform === "linux") {
      try {
        const { stdout } = await execFileAsync("lspci", [], { timeout: 5_000 });
        const line = stdout
          .split("\n")
          .find((l) => /vga|3d|display/i.test(l));
        if (line) {
          const name = line.replace(/^[^:]+:\s*/, "").trim();
          return { name };
        }
      } catch {
        /* lspci may be unavailable */
      }
    }
  } catch (err) {
    log.warn("GPU enumeration failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return undefined;
}

/** Drop undefined keys so Socket.IO JSON matches Zod .strict() schemas. */
function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => pruneUndefined(item)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[key] = pruneUndefined(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Collects appropriate device management telemetry only —
 * no credentials, cookies, clipboard, or GPS.
 */
export class DeviceTelemetryCollector {
  async collect(latencyMs?: number): Promise<DeviceTelemetryPayload> {
    const cpus = os.cpus();
    const networkAddrs = pickNetworkAddresses();
    const defaultIface = await readDefaultInterface();
    // Prefer the default-route interface when it looks like a real adapter.
    const preferredIface =
      defaultIface && ifacePreference(defaultIface) <= 1
        ? defaultIface
        : networkAddrs.interfaceName;
    const resolvedAddrs =
      preferredIface && preferredIface !== networkAddrs.interfaceName
        ? (() => {
            const ifaces = os.networkInterfaces()[preferredIface];
            if (!ifaces) return networkAddrs;
            let localIp = networkAddrs.localIp;
            let ipv6 = networkAddrs.ipv6;
            for (const entry of ifaces) {
              if (entry.internal) continue;
              const family = String(entry.family);
              if ((family === "IPv4" || family === "4") && !entry.address.startsWith("169.254")) {
                localIp = entry.address;
              }
              if (
                (family === "IPv6" || family === "6") &&
                !entry.address.startsWith("fe80")
              ) {
                ipv6 = entry.address;
              }
            }
            return { localIp, ipv6, interfaceName: preferredIface };
          })()
        : { ...networkAddrs, interfaceName: preferredIface ?? networkAddrs.interfaceName };

    const [storage, gpu, platformVersion, connectionType] = await Promise.all([
      readStorage(),
      readGpu(),
      readPlatformVersion(),
      readConnectionType(resolvedAddrs.interfaceName),
    ]);

    const system: DeviceSystemInfoPayload = {
      hostname: os.hostname() || undefined,
      username: (() => {
        try {
          return os.userInfo().username || undefined;
        } catch {
          return undefined;
        }
      })(),
      platform: process.platform,
      platformVersion,
      architecture: os.arch(),
      agentVersion: readAgentVersion(),
      cpu: {
        model: cpus[0]?.model?.trim() || undefined,
        cores: cpus.length || undefined,
      },
      memory: {
        totalBytes: os.totalmem(),
        availableBytes: os.freemem(),
      },
      storage,
      gpu,
      displays: readDisplays(),
      uptimeSeconds: Math.floor(os.uptime()),
    };

    const network: DeviceNetworkInfoPayload = {
      ...resolvedAddrs,
      connectionType: connectionType || "unknown",
      ...(latencyMs != null && Number.isFinite(latencyMs)
        ? { latencyMs: Math.round(latencyMs) }
        : {}),
      connectionQuality: qualityFromLatency(latencyMs),
    };

    return pruneUndefined({ system, network });
  }
}
