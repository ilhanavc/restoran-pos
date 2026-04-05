import { execFile } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * winspool.Drv P/Invoke ile ham ESC/POS baytları gönderen PowerShell betiği.
 * $PrinterName : Windows yazıcı adı (Get-Printer çıktısındaki Name alanı)
 * $DataPath    : Ham bayt dosyasının tam yolu (geçici dosya)
 */
const RAW_PRINT_PS = `
param([string]$PrinterName, [string]$DataPath)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinspoolHelper {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DOCINFOW {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern int StartDocPrinter(IntPtr hPrinter, int Level, ref DOCINFOW pDocInfo);
    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBuf, int cbBuf, out int pcWritten);
}
'@ -WarningAction SilentlyContinue

$h = [IntPtr]::Zero
if (-not [WinspoolHelper]::OpenPrinter($PrinterName, [ref]$h, [IntPtr]::Zero)) {
    $ec = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Error "Yazici acilamadi: '$PrinterName' (Win32Error=$ec)"
    exit 1
}
try {
    $data = [System.IO.File]::ReadAllBytes($DataPath)
    $di   = New-Object WinspoolHelper+DOCINFOW
    $di.pDocName    = 'ESC/POS'
    $di.pOutputFile = $null
    $di.pDataType   = 'RAW'
    $docId = [WinspoolHelper]::StartDocPrinter($h, 1, [ref]$di)
    if ($docId -le 0) { Write-Error 'StartDocPrinter basarisiz'; exit 2 }
    if (-not [WinspoolHelper]::StartPagePrinter($h)) { Write-Error 'StartPagePrinter basarisiz'; exit 3 }
    $written = 0
    if (-not [WinspoolHelper]::WritePrinter($h, $data, $data.Length, [ref]$written)) {
        $ec = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        Write-Error "WritePrinter basarisiz (Win32Error=$ec)"
        exit 4
    }
    [void][WinspoolHelper]::EndPagePrinter($h)
    [void][WinspoolHelper]::EndDocPrinter($h)
    Write-Host "OK gonderildi=$written toplam=$($data.Length)"
} finally {
    [void][WinspoolHelper]::ClosePrinter($h)
}
`.trim();

/**
 * Windows yazıcı adıyla ham ESC/POS baytları gönderir (USB, paralel port vb.).
 * Yazıcı adı Windows'ta "Get-Printer | Select-Object Name" komutuyla bulunabilir.
 *
 * @param {{ printerName: string, buffer: Buffer, timeoutMs?: number }} opts
 * @returns {Promise<void>}
 */
export async function sendUsbPrint({ printerName, buffer, timeoutMs = 15000 }) {
  const name = String(printerName || '').trim();
  if (!name) {
    throw new Error('USB yazıcı adı (printer_name) gerekli');
  }

  const id = `${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
  const tmpBin = join(tmpdir(), `pos-usb-${id}.bin`);
  const tmpPs1 = join(tmpdir(), `pos-usb-${id}.ps1`);

  try {
    await Promise.all([
      writeFile(tmpBin, buffer),
      writeFile(tmpPs1, RAW_PRINT_PS, 'utf8'),
    ]);

    await new Promise((resolve, reject) => {
      const settled = { done: false };

      const timer = setTimeout(() => {
        if (settled.done) return;
        settled.done = true;
        reject(new Error(`USB yazıcı zaman aşımı (${timeoutMs} ms): ${name}`));
      }, timeoutMs);

      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy', 'Bypass',
          '-File', tmpPs1,
          '-PrinterName', name,
          '-DataPath', tmpBin,
        ],
        { windowsHide: true, maxBuffer: 256 * 1024 },
        (err, stdout, stderr) => {
          clearTimeout(timer);
          if (settled.done) return;
          settled.done = true;
          if (err) {
            const detail = (stderr || '').trim() || err.message;
            return reject(new Error(`USB baskı hatası [${name}]: ${detail.slice(0, 500)}`));
          }
          const out = (stdout || '').trim();
          if (out && !out.startsWith('OK')) {
            return reject(new Error(`USB yazıcı beklenmedik yanıt [${name}]: ${out.slice(0, 300)}`));
          }
          resolve();
        },
      );
    });
  } finally {
    unlink(tmpBin).catch(() => {});
    unlink(tmpPs1).catch(() => {});
  }
}
