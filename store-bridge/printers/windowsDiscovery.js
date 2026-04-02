import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const name = String(row?.Name || row?.name || '').trim();
      if (!name) return null;
      const isDefault = row?.Default === true || row?.default === true;
      const workOffline = row?.WorkOffline === true || row?.workOffline === true;
      return {
        name,
        isDefault,
        isOnline: !workOffline,
      };
    })
    .filter(Boolean);
}

export async function discoverWindowsPrinters() {
  const command =
    "Get-Printer | Select-Object Name,Default,WorkOffline | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
    windowsHide: true,
    timeout: 12000,
    maxBuffer: 1024 * 1024,
  });
  const raw = String(stdout || '').trim();
  if (!raw) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return normalizeRows(rows);
}
