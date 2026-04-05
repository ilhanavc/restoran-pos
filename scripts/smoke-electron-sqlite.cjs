/**
 * Packaging öncesi: Electron'un Node runtime'ı (ELECTRON_RUN_AS_NODE) altında
 * server/node_modules/better-sqlite3 gerçekten yükleniyor mu?
 * Başarısızsa exit 1 — dist:win durur.
 */
const path = require('path');
const fs = require('fs');

if (!process.env.ELECTRON_RUN_AS_NODE || process.env.ELECTRON_RUN_AS_NODE === '0') {
  console.error('[smoke-electron-sqlite] FAIL: ELECTRON_RUN_AS_NODE=1 gerekli');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const pkgRoot = path.join(root, 'server', 'node_modules', 'better-sqlite3');
const nodeBinary = path.join(pkgRoot, 'build', 'Release', 'better_sqlite3.node');

if (!process.versions.electron) {
  console.error('[smoke-electron-sqlite] FAIL: process.versions.electron yok — ELECTRON_RUN_AS_NODE ile Electron ikilisi kullanılmıyor olabilir');
  process.exit(1);
}
console.log('[smoke-electron-sqlite] process.versions.electron =', process.versions.electron);
console.log('[smoke-electron-sqlite] process.versions.node =', process.versions.node);
console.log('[smoke-electron-sqlite] process.versions.modules (NODE_MODULE_VERSION) =', process.versions.modules);
console.log('[smoke-electron-sqlite] better_sqlite3.node =', nodeBinary);
console.log('[smoke-electron-sqlite] binary exists =', fs.existsSync(nodeBinary));
if (fs.existsSync(nodeBinary)) {
  console.log('[smoke-electron-sqlite] binary mtime =', fs.statSync(nodeBinary).mtime.toISOString());
}

try {
  const Database = require(pkgRoot);
  const db = new Database(':memory:');
  const row = db.prepare('SELECT 1 AS ok').get();
  db.close();
  if (!row || row.ok !== 1) {
    console.error('[smoke-electron-sqlite] FAIL: sorgu sonucu beklenmiyor');
    process.exit(1);
  }
  console.log('[smoke-electron-sqlite] OK: better-sqlite3 Electron-as-Node altında yüklendi');
  process.exit(0);
} catch (e) {
  const msg = e && e.message ? e.message : String(e);
  console.error('[smoke-electron-sqlite] FAIL:', msg);
  process.exit(1);
}
