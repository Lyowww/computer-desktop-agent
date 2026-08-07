import { execFile } from "child_process";
import { promisify } from "util";
import { rootLogger } from "../../utils/logger";

const execFileAsync = promisify(execFile);
const log = rootLogger.child("system-info");

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu?: number;
}

export interface AppInfo {
  name: string;
  path?: string;
  running: boolean;
}

export class SystemInfoService {
  async listProcesses(limit = 40): Promise<ProcessInfo[]> {
    const capped = Math.min(Math.max(limit, 1), 100);
    if (process.platform === "darwin" || process.platform === "linux") {
      const { stdout } = await execFileAsync(
        "ps",
        ["-axo", "pid=,comm=,%cpu=", "-r"],
        { timeout: 8000, maxBuffer: 2 * 1024 * 1024 }
      );
      const rows: ProcessInfo[] = [];
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^(\d+)\s+(\S+)\s+([\d.]+)/);
        if (!match) continue;
        rows.push({
          pid: Number(match[1]),
          name: match[2],
          cpu: Number(match[3]),
        });
        if (rows.length >= capped) break;
      }
      log.info("Listed processes", { count: rows.length });
      return rows;
    }

    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Get-Process | Sort-Object CPU -Descending | Select-Object -First ${capped} | ForEach-Object { \"$($_.Id)|$($_.ProcessName)|$([math]::Round($_.CPU,1))\" }`,
        ],
        { timeout: 10_000, windowsHide: true }
      );
      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [pid, name, cpu] = line.split("|");
          return { pid: Number(pid), name, cpu: Number(cpu) || undefined };
        });
    }

    return [];
  }

  async listRunningApps(limit = 40): Promise<AppInfo[]> {
    const capped = Math.min(Math.max(limit, 1), 100);

    if (process.platform === "darwin") {
      try {
        const { stdout } = await execFileAsync(
          "/usr/bin/osascript",
          [
            "-e",
            'tell application "System Events" to get name of (every process whose background only is false)',
          ],
          { timeout: 8000 }
        );
        const names = stdout
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean)
          .slice(0, capped);
        log.info("Listed running apps", { count: names.length });
        return names.map((name) => ({ name, running: true }));
      } catch (error) {
        log.warn("Failed to list macOS apps via System Events", {
          error: error instanceof Error ? error.message : String(error),
        });
        // Fallback: unique process names from ps
        const procs = await this.listProcesses(capped);
        const seen = new Set<string>();
        const apps: AppInfo[] = [];
        for (const p of procs) {
          const base = p.name.split("/").pop() || p.name;
          if (seen.has(base)) continue;
          seen.add(base);
          apps.push({ name: base, running: true });
          if (apps.length >= capped) break;
        }
        return apps;
      }
    }

    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -First ${capped} -ExpandProperty ProcessName`,
        ],
        { timeout: 10_000, windowsHide: true }
      );
      const names = [...new Set(stdout.split("\n").map((n) => n.trim()).filter(Boolean))];
      return names.map((name) => ({ name, running: true }));
    }

    // Linux: best-effort via wmctrl if present, else process list
    try {
      const { stdout } = await execFileAsync("wmctrl", ["-l"], { timeout: 5000 });
      const names = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^(\S+\s+){3}/, "").trim())
        .slice(0, capped);
      return names.map((name) => ({ name, running: true }));
    } catch {
      const procs = await this.listProcesses(capped);
      return procs.map((p) => ({ name: p.name, running: true }));
    }
  }
}
