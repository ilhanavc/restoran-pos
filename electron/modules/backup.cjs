const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const { getPosConfigPath, getCodeRoot, getPackagedServerRoot } = require('./config.cjs');
const { getMainWindow } = require('./window.cjs');
const { todayInIstanbul, dateTimeStampInIstanbul, msUntilNextHourInIstanbul } = require('./time.cjs');

const BACKUP_KEEP_DAYS = 30;
const BACKUP_HOUR = 2;

/** @type {NodeJS.Timeout | null} */
let backupTimer = null;

function requireBetterSqlite3ForBackup() {
  const serverRoot = app.isPackaged ? getPackagedServerRoot() : path.join(getCodeRoot(), 'server');
  const modulePath = path.join(serverRoot, 'node_modules', 'better-sqlite3');
  return require(modulePath);
}

function verifySqliteBackup(Database, backupPath) {
  const backupDb = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    const result = backupDb.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(`integrity_check=${result}`);
  } finally {
    backupDb.close();
  }
}

async function checkDiskSpaceForBackup(dbPath, backupsDir) {
  try {
    const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    if (dbSize === 0) return;
    let freeBytes = Infinity;
    if (typeof fs.statfsSync === 'function') {
      const stat = fs.statfsSync(backupsDir);
      freeBytes = stat.bfree * stat.bsize;
    } else {
      return;
    }
    const threshold = dbSize * 3;
    if (freeBytes < threshold) {
      const msg = `Disk alanı yetersiz: ${Math.round(freeBytes / 1024 / 1024)} MB serbest, en az ${Math.round(threshold / 1024 / 1024)} MB gerekli`;
      console.warn('[backup] ' + msg);
      getMainWindow()?.webContents?.send('backup-disk-warning', { message: msg, freeBytes, dbSize });
    }
  } catch (e) {
    console.warn('[backup] Disk alanı kontrolü yapılamadı (kritik değil):', e?.message || e);
  }
}

async function performBackup(dbPath) {
  const backupsDir = path.join(app.getPath('userData'), 'backups');
  let tempPath = null;
  try {
    if (!fs.existsSync(dbPath)) {
      console.warn('[backup] Veritabanı bulunamadı, yedek atlandı:', dbPath);
      return;
    }
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

    await checkDiskSpaceForBackup(dbPath, backupsDir);

    const dateStr = todayInIstanbul();
    const backupPath = path.join(backupsDir, `pos-${dateStr}.db`);
    if (fs.existsSync(backupPath)) {
      console.log('[backup] Bugünkü yedek zaten mevcut:', backupPath);
      return;
    }

    const Database = requireBetterSqlite3ForBackup();
    const liveDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    tempPath = `${backupPath}.tmp-${process.pid}`;
    try {
      await liveDb.backup(tempPath);
    } finally {
      liveDb.close();
    }
    verifySqliteBackup(Database, tempPath);
    fs.renameSync(tempPath, backupPath);
    tempPath = null;
    console.log('[backup] ✅ WAL-güvenli veritabanı yedeklendi:', backupPath);

    try {
      const userDataPath = app.getPath('userData');
      const srcUploads = path.join(userDataPath, 'uploads', 'products');
      const destUploads = path.join(backupsDir, `uploads-${dateStr}`);
      if (fs.existsSync(srcUploads) && !fs.existsSync(destUploads)) {
        fs.mkdirSync(destUploads, { recursive: true });
        for (const file of fs.readdirSync(srcUploads)) {
          fs.copyFileSync(path.join(srcUploads, file), path.join(destUploads, file));
        }
        console.log('[backup] uploads/products/ yedeklendi:', destUploads);
      }
    } catch (uploadErr) {
      console.warn('[backup] uploads yedeklemesi başarısız (kritik değil):', uploadErr?.message || uploadErr);
    }

    try {
      const configSrcPath = getPosConfigPath();
      if (configSrcPath && fs.existsSync(configSrcPath)) {
        const configDestPath = path.join(backupsDir, `pos-${dateStr}.config.json`);
        if (!fs.existsSync(configDestPath)) {
          fs.copyFileSync(configSrcPath, configDestPath);
          console.log('[backup] pos-config.json yedeklendi:', configDestPath);
        }
      }
    } catch (cfgErr) {
      console.warn('[backup] pos-config.json yedeği alınamadı (kritik değil):', cfgErr?.message || cfgErr);
    }

    try {
      const metaDb = new Database(backupPath, { readonly: true, fileMustExist: true });
      let schemaVersion = 0, rowCounts = {}, integrityResult = 'unknown';
      try {
        schemaVersion = metaDb.pragma('user_version', { simple: true });
        integrityResult = metaDb.pragma('integrity_check', { simple: true });
        rowCounts = {
          orders: metaDb.prepare('SELECT COUNT(*) AS c FROM orders').get()?.c ?? 0,
          payments: metaDb.prepare('SELECT COUNT(*) AS c FROM payments').get()?.c ?? 0,
          customers: metaDb.prepare('SELECT COUNT(*) AS c FROM customers').get()?.c ?? 0,
        };
      } finally {
        metaDb.close();
      }
      let appVersion = 'unknown';
      try {
        const pkgPath = app.isPackaged
          ? path.join(app.getAppPath(), 'package.json')
          : path.join(__dirname, '..', '..', 'package.json');
        appVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || 'unknown';
      } catch { /* ignore */ }

      let sha256 = null;
      try {
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256');
        hash.update(fs.readFileSync(backupPath));
        sha256 = hash.digest('hex');
      } catch { /* ignore */ }

      const meta = {
        appVersion, schemaVersion, createdAt: new Date().toISOString(), type: 'automatic',
        rowCounts, integrityCheck: integrityResult,
        dbSizeBytes: fs.statSync(backupPath).size, sha256,
      };
      const metaPath = path.join(backupsDir, `pos-${dateStr}.meta.json`);
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
      console.log('[backup] Meta dosyası yazıldı (sha256:', sha256?.slice(0, 12), '...):', metaPath);
    } catch (metaErr) {
      console.warn('[backup] Meta dosyası yazılamadı (kritik değil):', metaErr?.message || metaErr);
    }

    cleanOldBackups(backupsDir);
  } catch (e) {
    if (tempPath && fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    }
    const errMsg = e?.message || String(e);
    console.error('[backup] Yedekleme hatası:', errMsg);
    getMainWindow()?.webContents?.send('backup-failed', { message: errMsg });
  }
}

function cleanOldBackups(backupsDir) {
  try {
    const cutoffMs = Date.now() - BACKUP_KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(backupsDir)) {
      const fp = path.join(backupsDir, entry);
      try {
        const stat = fs.statSync(fp);
        if (stat.mtimeMs >= cutoffMs) continue;
        if (entry.startsWith('pos-') && entry.endsWith('.db')) { fs.unlinkSync(fp); continue; }
        if (entry.startsWith('pos-') && entry.endsWith('.meta.json')) { fs.unlinkSync(fp); continue; }
        if (entry.startsWith('pos-') && entry.endsWith('.config.json')) { fs.unlinkSync(fp); continue; }
        if (entry.startsWith('uploads-') && stat.isDirectory()) {
          fs.rmSync(fp, { recursive: true, force: true });
        }
      } catch { /* dosya/klasör silinemezse atla */ }
    }
  } catch (e) {
    console.warn('[backup] Eski yedek temizleme hatası:', e?.message || String(e));
  }
}

function msUntilNextBackupHour() {
  return msUntilNextHourInIstanbul(BACKUP_HOUR);
}

function scheduleBackup(dbPath) {
  performBackup(dbPath).catch((err) => {
    console.error('[backup] Başlangıç yedeği alınamadı:', err?.message || String(err));
  });

  const msFirst = msUntilNextBackupHour();
  console.log(`[backup] Sonraki otomatik yedek: ${Math.round(msFirst / 60000)} dakika sonra (gece ${BACKUP_HOUR}:00)`);

  backupTimer = setTimeout(() => {
    performBackup(dbPath).catch((err) => {
      console.error('[backup] Zamanlanmış yedek alınamadı:', err?.message || String(err));
    });
    backupTimer = setInterval(() => {
      performBackup(dbPath).catch((err) => {
        console.error('[backup] Günlük yedek alınamadı:', err?.message || String(err));
      });
    }, 24 * 60 * 60 * 1000);
    backupTimer?.unref?.();
  }, msFirst);
  backupTimer?.unref?.();
}

function safeRestoreBackupName(value) {
  const fileName = path.basename(String(value || '').trim());
  if (!/^(pos|pos-manual|restore-safety)-[A-Za-z0-9._-]+\.db$/.test(fileName)) return null;
  return fileName;
}

function removeSqliteSidecars(dbPath) {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbPath}${suffix}`;
    if (!fs.existsSync(sidecar)) continue;
    try { fs.unlinkSync(sidecar); } catch (err) {
      console.warn('[restore] SQLite yan dosyası silinemedi:', sidecar, err?.message || err);
    }
  }
}

async function createRestoreSafetyBackup(Database, dbPath, backupsDir) {
  if (!fs.existsSync(dbPath)) return null;
  const stamp = dateTimeStampInIstanbul();
  const safetyPath = path.join(backupsDir, `restore-safety-${stamp}.db`);
  const liveDb = new Database(dbPath, { readonly: true, fileMustExist: true });
  try { await liveDb.backup(safetyPath); } finally { liveDb.close(); }
  verifySqliteBackup(Database, safetyPath);
  return safetyPath;
}

async function applyPendingRestoreIfAny(dbPath) {
  const userDataPath = app.getPath('userData');
  const requestPath = path.join(userDataPath, 'restore-request.json');
  if (!fs.existsSync(requestPath)) return;

  let request;
  try {
    request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  } catch (err) {
    console.error('[restore] Restore isteği okunamadı:', err?.message || err);
    fs.unlinkSync(requestPath);
    return;
  }

  const backupName = safeRestoreBackupName(request?.backupFile);
  if (!backupName) {
    console.error('[restore] Geçersiz restore dosyası:', request?.backupFile);
    fs.unlinkSync(requestPath);
    return;
  }

  const backupsDir = path.join(userDataPath, 'backups');
  const backupPath = path.join(backupsDir, backupName);
  if (!fs.existsSync(backupPath)) {
    console.error('[restore] Restore yedeği bulunamadı:', backupPath);
    fs.unlinkSync(requestPath);
    return;
  }

  try {
    const metaName = backupName.replace(/\.db$/, '.meta.json');
    const metaPath = path.join(backupsDir, metaName);
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta?.sha256) {
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256');
        hash.update(fs.readFileSync(backupPath));
        const actual = hash.digest('hex');
        if (actual !== meta.sha256) {
          throw new Error(`Yedek dosyası bozuk: SHA-256 uyuşmuyor. Beklenen=${meta.sha256.slice(0, 12)}… Gerçek=${actual.slice(0, 12)}…`);
        }
        console.log('[restore] SHA-256 doğrulandı:', actual.slice(0, 12) + '…');
      }
    }
  } catch (hashErr) {
    if (hashErr.message.startsWith('Yedek dosyası bozuk')) throw hashErr;
    console.warn('[restore] SHA-256 doğrulaması yapılamadı (kritik değil):', hashErr?.message);
  }

  const Database = requireBetterSqlite3ForBackup();
  const tempPath = `${dbPath}.restore-${process.pid}.tmp`;
  let safetyPath = null;
  try {
    verifySqliteBackup(Database, backupPath);
    fs.copyFileSync(backupPath, tempPath);
    verifySqliteBackup(Database, tempPath);
    safetyPath = await createRestoreSafetyBackup(Database, dbPath, backupsDir);

    removeSqliteSidecars(dbPath);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    fs.renameSync(tempPath, dbPath);
    removeSqliteSidecars(dbPath);

    try {
      const postDb = new Database(dbPath, { readonly: true, fileMustExist: true });
      let postIntegrity;
      try { postIntegrity = postDb.pragma('integrity_check', { simple: true }); } finally { postDb.close(); }
      if (postIntegrity !== 'ok') {
        console.error('[restore] Post-restore integrity_check başarısız:', postIntegrity, '— safety yedeğine geri dönülüyor');
        if (safetyPath && fs.existsSync(safetyPath)) {
          removeSqliteSidecars(dbPath);
          if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
          fs.copyFileSync(safetyPath, dbPath);
          console.error('[restore] Safety yedeğine geri dönüldü:', safetyPath);
        }
        throw new Error(`Restore sonrası integrity_check başarısız: ${postIntegrity}`);
      }
      console.log('[restore] Post-restore integrity_check: ok');
    } catch (verifyErr) {
      if (verifyErr.message.startsWith('Restore sonrası')) throw verifyErr;
      console.warn('[restore] Post-restore doğrulama çalıştırılamadı (kritik değil):', verifyErr?.message);
    }

    try {
      const dateStamp = backupName.replace(/^pos-/, '').replace(/\.db$/, '');
      const backupUploads = path.join(backupsDir, `uploads-${dateStamp}`);
      if (fs.existsSync(backupUploads)) {
        const destUploads = path.join(app.getPath('userData'), 'uploads', 'products');
        fs.mkdirSync(destUploads, { recursive: true });
        for (const file of fs.readdirSync(backupUploads)) {
          fs.copyFileSync(path.join(backupUploads, file), path.join(destUploads, file));
        }
        console.log('[restore] uploads/products/ geri yüklendi:', backupUploads);
      }
    } catch (uploadErr) {
      console.warn('[restore] uploads geri yükleme başarısız (kritik değil):', uploadErr?.message || uploadErr);
    }

    try {
      const dateStamp = backupName.replace(/^pos-/, '').replace(/\.db$/, '');
      const configBackupPath = path.join(backupsDir, `pos-${dateStamp}.config.json`);
      if (fs.existsSync(configBackupPath)) {
        const configDestPath = getPosConfigPath();
        if (configDestPath) {
          fs.copyFileSync(configBackupPath, configDestPath);
          console.log('[restore] pos-config.json geri yüklendi. JWT secret ve bridge token yeniden yükleniyor.');
        }
      }
    } catch (cfgErr) {
      console.warn('[restore] pos-config.json geri yükleme başarısız (kritik değil):', cfgErr?.message || cfgErr);
    }

    fs.unlinkSync(requestPath);
    console.log('[restore] ✅ Yedek geri yüklendi:', backupName, safetyPath ? `safety=${safetyPath}` : '');
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    }
    console.error('[restore] Restore uygulanamadı:', err?.message || err);
    throw err;
  }
}

module.exports = {
  performBackup, scheduleBackup, applyPendingRestoreIfAny,
  verifySqliteBackup, requireBetterSqlite3ForBackup, safeRestoreBackupName,
};
