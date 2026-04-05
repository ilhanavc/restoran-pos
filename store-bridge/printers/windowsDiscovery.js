import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PS_OPTS = { windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024 };

/**
 * Get-PrinterPort çıktısından port adı → IP adresi haritası oluşturur.
 * TCP/IP portları (TCPIP_ veya IP_ ön ekli, ya da HostAddress dolu) IP içerir.
 * Döndürür: Map<portName, ipAddress>
 */
async function fetchPortIpMap() {
  const command = [
    'Get-PrinterPort',
    '| Select-Object Name,PrinterHostAddress,HostAddress',
    '| ConvertTo-Json -Compress',
  ].join(' ');

  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], PS_OPTS));
  } catch {
    // Get-PrinterPort bazı Windows sürümlerinde yoksa WMI'ya düş
    return fetchPortIpMapWmi();
  }

  const raw = String(stdout || '').trim();
  if (!raw) return fetchPortIpMapWmi();

  let parsed;
  try { parsed = JSON.parse(raw); } catch { return fetchPortIpMapWmi(); }

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const map = new Map();
  for (const r of rows) {
    const name = String(r?.Name || '').trim();
    const ip = String(r?.PrinterHostAddress || r?.HostAddress || '').trim();
    if (name && ip) map.set(name, ip);
  }
  return map;
}

/**
 * WMI (Win32_TCPIPPrinterPort) ile fallback port → IP haritası.
 * Get-PrinterPort'un olmadığı ortamlarda kullanılır.
 */
async function fetchPortIpMapWmi() {
  const command = [
    'Get-WmiObject Win32_TCPIPPrinterPort',
    '| Select-Object Name,HostAddress',
    '| ConvertTo-Json -Compress',
  ].join(' ');

  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], PS_OPTS));
  } catch {
    return new Map();
  }

  const raw = String(stdout || '').trim();
  if (!raw) return new Map();

  let parsed;
  try { parsed = JSON.parse(raw); } catch { return new Map(); }

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const map = new Map();
  for (const r of rows) {
    const name = String(r?.Name || '').trim();
    const ip = String(r?.HostAddress || '').trim();
    if (name && ip) map.set(name, ip);
  }
  return map;
}

/**
 * IP adresi gibi görünüyor mu? (basit kontrol)
 * @param {string} s
 */
function looksLikeIp(s) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(String(s || '').trim());
}

/**
 * Port adından bağlantı türünü tahmin eder.
 * USB*, LPT*, DOT4* → usb | network fallback
 */
function guessConnectionType(portName, ipAddress) {
  const p = String(portName || '').toUpperCase();
  if (/^(USB|DOT4|LPT)/.test(p)) return 'usb';
  if (ipAddress) return 'network';
  // WSD portları ağ yazıcısı olabilir ama IP'si yoktur
  if (/^WSD/.test(p)) return 'network';
  return 'usb';
}

/**
 * Her yazıcı için PortName alanını da çeker.
 * Döndürür: Array<{ Name, Default, WorkOffline, PortName }>
 */
async function fetchPrintersWithPort() {
  const command = [
    'Get-Printer',
    '| Select-Object Name,Default,WorkOffline,PortName',
    '| ConvertTo-Json -Compress',
  ].join(' ');

  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], PS_OPTS);
  const raw = String(stdout || '').trim();
  if (!raw) return [];

  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Windows yazıcılarını keşfeder; her yazıcı için:
 *   name, isDefault, isOnline, connectionType ('network'|'usb'), ipAddress (ağ için)
 */
export async function discoverWindowsPrinters() {
  const [rows, portIpMap] = await Promise.all([
    fetchPrintersWithPort(),
    fetchPortIpMap(),
  ]);

  return rows
    .map((row) => {
      const name = String(row?.Name || row?.name || '').trim();
      if (!name) return null;

      const isDefault = row?.Default === true || row?.default === true;
      const workOffline = row?.WorkOffline === true || row?.workOffline === true;
      const portName = String(row?.PortName || row?.portName || '').trim();

      // Port haritasından IP'yi al; yoksa port adının kendisi IP mi?
      let ipAddress = portIpMap.get(portName) || '';
      if (!ipAddress && looksLikeIp(portName)) ipAddress = portName;

      const connectionType = guessConnectionType(portName, ipAddress);

      return {
        name,
        isDefault,
        isOnline: !workOffline,
        connectionType,
        ipAddress: connectionType === 'network' ? ipAddress : '',
        portName,
      };
    })
    .filter(Boolean);
}
