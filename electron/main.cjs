/**
 * Electron main: child process'te Express (server/index.js), BrowserWindow ile http://127.0.0.1:PORT
 * Express kodu Electron içine gömülmez; file:// kullanılmaz.
 * pos-config.json mevcutsa ayarlar oradan okunur; Store Bridge otomatik başlatılır.
 */
const { app, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const { setupFileLogging, initSentry, closeLogs } = require('./modules/logging.cjs');
const {
  loadPosConfig, getPosConfig, getCloudServerUrl, readPosConfig, getPosConfigPath, ensureJwtSecret,
  getCodeRoot, getPackagedServerRoot,
} = require('./modules/config.cjs');
const { copyLegacySqliteToUserDataIfNeeded } = require('./modules/sqliteMigration.cjs');
const { startServerAndWaitForHealth, stopServerProcess } = require('./modules/serverProcess.cjs');
const { startStoreBridge, stopBridge } = require('./modules/bridgeProcess.cjs');
const { startCallerIdHelper, stopCallerIdHelper } = require('./modules/callerIdProcess.cjs');
const { createWindow, getMainWindow } = require('./modules/window.cjs');
const {
  scheduleBackup, applyPendingRestoreIfAny,
  performBackup, verifySqliteBackup, requireBetterSqlite3ForBackup, safeRestoreBackupName,
} = require('./modules/backup.cjs');

// ---------------------------------------------------------------------------
// Uygulama başlangıcı
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  app.setName('Restoran POS');
  setupFileLogging();

  loadPosConfig();
  const posConfig = getPosConfig();
  ensureJwtSecret();
  initSentry(posConfig.sentryDsn || process.env.SENTRY_DSN, app.getVersion());
  const cloudServerUrl = getCloudServerUrl();

  const codeRoot = getCodeRoot();
  const distIndex = path.join(codeRoot, 'client', 'dist', 'index.html');
  if (!cloudServerUrl && !fs.existsSync(distIndex)) {
    dialog.showErrorBox(
      'Eksik build',
      'client/dist bulunamadı. Önce proje kökünde "npm run build" çalıştırın, ardından Electron\'u yeniden başlatın.',
    );
    app.quit();
    return;
  }

  const userDataDbPath = path.join(app.getPath('userData'), 'pos.db');
  const legacyDbMain = app.isPackaged
    ? path.join(getPackagedServerRoot(), 'data', 'pos.db')
    : path.join(codeRoot, 'server', 'data', 'pos.db');

  try {
    if (cloudServerUrl) {
      console.log('[electron] Cloud server URL yapılandırıldı; local POS API başlatılmıyor:', cloudServerUrl);
      createWindow(null, cloudServerUrl);
      startStoreBridge(null, cloudServerUrl);
      const cidTimer = setTimeout(() => startCallerIdHelper(null, cloudServerUrl), 3000);
      cidTimer.unref?.();
      return;
    }

    copyLegacySqliteToUserDataIfNeeded(userDataDbPath, legacyDbMain);
    await applyPendingRestoreIfAny(userDataDbPath);
    const port = await startServerAndWaitForHealth(userDataDbPath);
    scheduleBackup(userDataDbPath);
    createWindow(port);
    startStoreBridge(port);
    const cidTimer = setTimeout(() => startCallerIdHelper(port), 3000);
    cidTimer.unref?.();
  } catch (err) {
    const msg = err?.message || String(err);
    dialog.showErrorBox('POS sunucusu başlatılamadı', msg);
    app.quit();
  }
});

// ---------------------------------------------------------------------------
// electron-updater — otomatik güncelleme
// ---------------------------------------------------------------------------

function initAutoUpdater() {
  if (!app.isPackaged) return;

  let autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch {
    console.log('[updater] electron-updater yüklü değil; güncelleme devre dışı.');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => { console.log('[updater] Güncelleme kontrol ediliyor...'); });
  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] Güncelleme mevcut: v${info.version}`);
    getMainWindow()?.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes || '',
    });
  });
  autoUpdater.on('update-not-available', () => { console.log('[updater] Uygulama güncel.'); });
  autoUpdater.on('download-progress', (progress) => {
    getMainWindow()?.webContents.send('download-progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] v${info.version} indirildi, kurulum bekliyor.`);
    getMainWindow()?.webContents.send('update-downloaded', { version: info.version });
  });
  autoUpdater.on('error', (err) => {
    const msg = err?.message || String(err);
    console.error('[updater] Hata:', msg);
    getMainWindow()?.webContents.send('update-error', { message: msg });
  });

  ipcMain.on('install-update', () => { autoUpdater.quitAndInstall(); });
  ipcMain.on('check-for-updates', () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] checkForUpdates hatası:', err?.message);
    });
  });

  const timer = setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.log('[updater] Güncelleme kontrolü yapılamadı:', err?.message || err);
    });
  }, 10000);
  timer.unref?.();
}

app.whenReady().then(() => initAutoUpdater());

ipcMain.on('restart-app', () => { app.relaunch(); app.quit(); });

// Mevcut uygulama versiyonu — package.json'dan
ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.on('config:get-electron-config', (event) => {
  event.returnValue = {
    apiBaseUrl: getCloudServerUrl(),
  };
});

// ---------------------------------------------------------------------------
// İlk kurulum wizard IPC
// ---------------------------------------------------------------------------

ipcMain.handle('setup:is-completed', () => {
  const cfg = readPosConfig();
  return cfg.setupCompleted === true;
});

ipcMain.handle('setup:complete', (_event, { businessName }) => {
  const cfgPath = getPosConfigPath();
  let cfg = {};
  if (fs.existsSync(cfgPath)) {
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) { /* bozuk JSON */ }
  }
  cfg.setupCompleted = true;
  if (businessName) cfg.businessName = businessName;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  console.log('[electron] İlk kurulum tamamlandı, pos-config.json güncellendi.');
  return { ok: true };
});

// ---------------------------------------------------------------------------
// P3-1: Windows Görev Zamanlayıcı ile harici yedek kopyalama
// ---------------------------------------------------------------------------

const SCHTASK_NAME = 'RestaurantPOS-BackupCopy';

ipcMain.handle('backup:pick-external-folder', async () => {
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: 'Yedeklerin kopyalanacağı klasörü seçin (USB, ağ sürücüsü...)',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('backup:scheduler-status', async () => {
  const { execFile } = require('child_process');
  return new Promise((resolve) => {
    execFile(
      'schtasks',
      ['/Query', '/TN', SCHTASK_NAME, '/FO', 'LIST', '/V'],
      { encoding: 'buffer', windowsHide: true },
      (err, stdout) => {
        if (err) return resolve({ exists: false });
        const out = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : stdout;
        const destMatch = out.match(/Comment:\s*(.+)/i);
        const lastMatch = out.match(/Last Result:\s*(.+)/i);
        const nextMatch = out.match(/Next Run Time:\s*(.+)/i);
        resolve({
          exists: true,
          taskName: SCHTASK_NAME,
          destFolder: destMatch ? destMatch[1].trim() : null,
          lastResult: lastMatch ? lastMatch[1].trim() : null,
          nextRunTime: nextMatch ? nextMatch[1].trim() : null,
        });
      },
    );
  });
});

ipcMain.handle('backup:scheduler-save', async (_event, destFolder) => {
  if (!destFolder || typeof destFolder !== 'string') throw new Error('Hedef klasör belirtilmedi');

  const backupsDir = path.join(app.getPath('userData'), 'backups');
  const action = `robocopy "${backupsDir}" "${destFolder}" pos-*.db /XO /NJH /NJS /NDL /R:2 /W:5`;
  const { execFile } = require('child_process');

  await new Promise((resolve) => {
    execFile('schtasks', ['/Delete', '/TN', SCHTASK_NAME, '/F'], { windowsHide: true }, () => resolve());
  });

  return new Promise((resolve, reject) => {
    execFile(
      'schtasks',
      ['/Create', '/TN', SCHTASK_NAME, '/TR', `cmd /c ${action}`, '/SC', 'DAILY', '/ST', '03:00', '/RL', 'HIGHEST', '/F', '/MO', '1'],
      { windowsHide: true },
      (err, _stdout, stderr) => {
        if (err) return reject(new Error(`Görev oluşturulamadı: ${stderr || err.message}`));
        try {
          const cfgPath = path.join(app.getPath('userData'), 'backup-scheduler.json');
          fs.writeFileSync(cfgPath, JSON.stringify({ destFolder, taskName: SCHTASK_NAME, createdAt: new Date().toISOString() }, null, 2), 'utf8');
        } catch { /* ignore */ }
        console.log('[backup:scheduler] Görev oluşturuldu. Hedef:', destFolder);
        resolve({ ok: true, destFolder });
      },
    );
  });
});

ipcMain.handle('backup:scheduler-remove', async () => {
  const { execFile } = require('child_process');
  return new Promise((resolve, reject) => {
    execFile(
      'schtasks', ['/Delete', '/TN', SCHTASK_NAME, '/F'], { windowsHide: true },
      (err, _stdout, stderr) => {
        if (err) return reject(new Error(`Görev kaldırılamadı: ${stderr || err.message}`));
        try {
          const cfgPath = path.join(app.getPath('userData'), 'backup-scheduler.json');
          if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
        } catch { /* ignore */ }
        console.log('[backup:scheduler] Görev kaldırıldı.');
        resolve({ ok: true });
      },
    );
  });
});

ipcMain.handle('backup:scheduler-run-now', async () => {
  let destFolder = null;
  try {
    const cfgPath = path.join(app.getPath('userData'), 'backup-scheduler.json');
    if (fs.existsSync(cfgPath)) {
      destFolder = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).destFolder;
    }
  } catch { /* ignore */ }

  if (!destFolder) throw new Error('Görev yapılandırması bulunamadı. Önce hedef klasörü kaydedin.');

  const backupsDir = path.join(app.getPath('userData'), 'backups');
  const { execFile } = require('child_process');
  return new Promise((resolve, reject) => {
    execFile(
      'robocopy',
      [backupsDir, destFolder, 'pos-*.db', '/XO', '/NJH', '/NJS', '/NDL', '/R:2', '/W:5'],
      { windowsHide: true },
      (err, stdout) => {
        const code = err?.code ?? 0;
        if (code > 7) return reject(new Error(`robocopy başarısız (exit ${code}): ${err?.message}`));
        const copiedMatch = (stdout || '').match(/(\d+)\s+Files Copied/i);
        const copied = copiedMatch ? parseInt(copiedMatch[1], 10) : 0;
        console.log(`[backup:scheduler] Elle kopyalama tamamlandı. ${copied} dosya → ${destFolder}`);
        resolve({ ok: true, copied, destFolder });
      },
    );
  });
});

ipcMain.handle('backup:scheduler-config', () => {
  try {
    const cfgPath = path.join(app.getPath('userData'), 'backup-scheduler.json');
    if (!fs.existsSync(cfgPath)) return null;
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch { return null; }
});

ipcMain.handle('backup:pick-external-db', async () => {
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: 'Geri yüklenecek veritabanı dosyasını seçin',
    filters: [{ name: 'SQLite Veritabanı', extensions: ['db'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const srcPath = result.filePaths[0];
  const Database = requireBetterSqlite3ForBackup();
  const backupsDir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const fileName = `pos-manual-${stamp}.db`;
  const destPath = path.join(backupsDir, fileName);
  fs.copyFileSync(srcPath, destPath);
  try {
    verifySqliteBackup(Database, destPath);
  } catch (verifyErr) {
    try { fs.unlinkSync(destPath); } catch { /* ignore */ }
    throw new Error(`Seçilen dosya geçerli bir SQLite veritabanı değil: ${verifyErr.message}`);
  }
  console.log('[backup] Dış kaynaklı yedek eklendi:', fileName);
  return fileName;
});

ipcMain.handle('backup:export', async (_event, backupFileName) => {
  const safeName = path.basename(String(backupFileName || '').trim());
  if (!/^(pos|pos-manual|restore-safety)-[A-Za-z0-9._-]+\.db$/.test(safeName)) {
    throw new Error('Geçersiz yedek dosyası adı');
  }
  const backupsDir = path.join(app.getPath('userData'), 'backups');
  const srcPath = path.join(backupsDir, safeName);
  if (!fs.existsSync(srcPath)) throw new Error('Yedek dosyası bulunamadı');

  const result = await dialog.showSaveDialog(getMainWindow(), {
    title: 'Yedeği farklı kaydet',
    defaultPath: safeName,
    filters: [{ name: 'SQLite Veritabanı', extensions: ['db'] }],
  });
  if (result.canceled || !result.filePath) return null;
  fs.copyFileSync(srcPath, result.filePath);
  console.log('[backup] Yedek dışa aktarıldı:', result.filePath);
  return result.filePath;
});

// ---------------------------------------------------------------------------
// Uygulama olayları
// ---------------------------------------------------------------------------

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopCallerIdHelper();
  stopServerProcess();
  stopBridge();
  closeLogs();
});
