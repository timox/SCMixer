import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeJsonAtomic } from '../session/atomic-file.js';

const execFileAsync = promisify(execFile);

/** Énumère les scsynth.exe du système : [{ pid, name, command }]. */
export async function listProcessesWindows() {
  const script = "Get-CimInstance Win32_Process -Filter \"Name='scsynth.exe'\" | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024,
  });
  const text = stdout.trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({ pid: p.ProcessId, name: p.Name, command: p.CommandLine ?? '' }));
}

/**
 * Registre des processus lancés par ce moteur (`runtime-processes.json`).
 * Un scsynth.exe n'est connu que si son PID et sa ligne de commande correspondent à une entrée.
 */
export class ProcessRegistry {
  constructor({ dataDir, listProcesses = listProcessesWindows }) {
    this.file = path.join(dataDir, 'runtime-processes.json');
    this.listProcesses = listProcesses;
  }

  entries() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  add({ role, pid, command }) {
    const entries = this.entries().filter((e) => e.pid !== pid);
    entries.push({ role, pid, command, startedAt: new Date().toISOString() });
    writeJsonAtomic(this.file, entries);
  }

  remove(pid) {
    writeJsonAtomic(this.file, this.entries().filter((e) => e.pid !== pid));
  }

  clear() {
    writeJsonAtomic(this.file, []);
  }

  async foreignScsynth() {
    const known = this.entries();
    const running = await this.listProcesses();
    return running.filter((p) => /^scsynth(\.exe)?$/i.test(p.name)
      && !known.some((e) => e.pid === p.pid && e.command === p.command));
  }
}

/**
 * Identifie le lanceur cmd.exe et le scsynth.exe réels sous un sclang (copie réduite du contrôle d'identité du hub).
 * Refuse si le lanceur n'est pas un cmd.exe enfant de sclang ou si scsynth ne correspond pas au port, à l'exécutable et au pilote.
 */
export function buildResolveScript({ launcherPid, sclangPid, serverPort, serverExecutable, device }) {
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$launcherPid = ${Number(launcherPid)}`,
    `$sclangPid = ${Number(sclangPid)}`,
    `$serverPort = ${Number(serverPort)}`,
    `$serverExecutable = ${quote(serverExecutable)}`,
    `$audioDevice = ${quote(device)}`,
    '$launcher = Get-CimInstance Win32_Process -Filter "ProcessId = $launcherPid"',
    'if (-not $launcher -or $launcher.Name -ne \'cmd.exe\' -or $launcher.ParentProcessId -ne $sclangPid) { throw "Lanceur Windows inattendu pour scsynth PID $launcherPid." }',
    '$servers = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $launcherPid" | Where-Object { $_.Name -eq \'scsynth.exe\' -and $_.CommandLine.Contains($serverExecutable) -and $_.CommandLine -match "(?:^|\\s)-u\\s+$serverPort(?:\\s|$)" -and $_.CommandLine.Contains($audioDevice) } | Select-Object ProcessId, ParentProcessId, CommandLine)',
    'if ($servers.Count -ne 1) { throw "Un seul scsynth.exe attendu sous le lanceur PID $launcherPid; $($servers.Count) trouvé(s)." }',
    '[PSCustomObject]@{ launcher = [PSCustomObject]@{ ProcessId = $launcher.ProcessId; ParentProcessId = $launcher.ParentProcessId; CommandLine = $launcher.CommandLine }; server = $servers[0] } | ConvertTo-Json -Compress -Depth 3',
  ].join('; ');
  return script;
}

export async function resolveScsynthWindows(params) {
  const { launcherPid, sclangPid, serverPort } = params;
  const script = buildResolveScript(params);
  const { stdout } = await execFileAsync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024,
  });
  const rec = JSON.parse(stdout.trim());
  const { launcher, server } = rec ?? {};
  if (!Number.isSafeInteger(launcher?.ProcessId) || launcher.ProcessId !== launcherPid
    || launcher.ParentProcessId !== sclangPid || !Number.isSafeInteger(server?.ProcessId)
    || server.ParentProcessId !== launcherPid || typeof server.CommandLine !== 'string') {
    throw new Error(`Identité de scsynth invalide sous le lanceur PID ${launcherPid}`);
  }
  return {
    launcher: { processId: launcher.ProcessId, parentProcessId: launcher.ParentProcessId, commandLine: launcher.CommandLine },
    server: { processId: server.ProcessId, parentProcessId: server.ParentProcessId, commandLine: server.CommandLine, serverPort },
  };
}
