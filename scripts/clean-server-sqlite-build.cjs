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
    fs.rmSync(p, { recursive: true, force: true });
    console.log('[clean-server-sqlite-build] removed', p);
  }
}
