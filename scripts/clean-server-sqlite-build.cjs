/**
 * better-sqlite3 önceden derlenmiş / indirilmiş native çıktıları siler;
 * sonraki @electron/rebuild --build-from-source gerçekten yeniden üretsin.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sqliteRoot = path.join(root, 'server', 'node_modules', 'better-sqlite3');
const toRemove = [
  path.join(sqliteRoot, 'build'),
  path.join(sqliteRoot, 'lib', 'binding'),
];

for (const p of toRemove) {
  if (fs.existsSync(p)) {
    try {
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      console.log('[clean-server-sqlite-build] removed', p);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.error('[clean-server-sqlite-build] FAIL:', msg);
      console.error('[clean-server-sqlite-build] better-sqlite3 dosyasi kilitli olabilir.');
      console.error('[clean-server-sqlite-build] Calisan POS/API/Electron/Vitest/Node sureclerini kapatip tekrar deneyin.');
      process.exit(1);
    }
  }
}
