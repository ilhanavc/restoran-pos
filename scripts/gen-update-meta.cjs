/**
 * gen-update-meta.cjs
 *
 * `dist:prepare` + `dist:nsis` sonrasında `dist-electron/latest.yml` üretir.
 * electron-updater'in `provider: github` yapılandırmasıyla çalışan `autoUpdater`
 * güncelleme kontrolü için GitHub Release'deki bu dosyaya başvurur.
 *
 * Kullanım:
 *   node scripts/gen-update-meta.cjs
 *   npm run dist:gen-update-meta
 *
 * Gereksinimler:
 *   - dist:prepare ve dist:nsis çalıştırılmış olmalı
 *   - dist-electron/ altında Setup.exe mevcut olmalı
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist-electron');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

// electron-builder NSIS çıktısı: "Restoran POS Setup X.Y.Z.exe"
// veya daha kısa adlandırma — gerçek dosyayı bul
function findSetupExe() {
  if (!fs.existsSync(distDir)) return null;
  const files = fs.readdirSync(distDir);
  // Setup.exe veya *Setup*.exe — en büyük .exe (portable değil kurulum)
  const candidates = files
    .filter((f) => f.endsWith('.exe') && /setup/i.test(f))
    .map((f) => ({ name: f, size: fs.statSync(path.join(distDir, f)).size }))
    .sort((a, b) => b.size - a.size);
  return candidates[0] || null;
}

function sha512Base64(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha512').update(buf).digest('base64');
}

const setupFile = findSetupExe();
if (!setupFile) {
  console.error('[gen-update-meta] FAIL: dist-electron/ altında Setup .exe bulunamadı.');
  console.error('[gen-update-meta] Önce `npm run dist:prepare && npm run dist:nsis` çalıştırın.');
  process.exit(1);
}

const setupPath = path.join(distDir, setupFile.name);
console.log(`[gen-update-meta] Installer: ${setupFile.name} (${(setupFile.size / 1024 / 1024).toFixed(1)} MB)`);

const hash = sha512Base64(setupPath);
const releaseDate = new Date().toISOString();

// latest.yml formatı electron-updater'ın beklediği YAML yapısıdır.
// Basit string template — YAML bağımlılığı gerektirmez.
const yaml = `version: ${version}
files:
  - url: ${setupFile.name}
    sha512: ${hash}
    size: ${setupFile.size}
path: ${setupFile.name}
sha512: ${hash}
releaseDate: '${releaseDate}'
`;

const outPath = path.join(distDir, 'latest.yml');
fs.writeFileSync(outPath, yaml, 'utf8');
console.log(`[gen-update-meta] OK: ${outPath}`);
console.log('[gen-update-meta] Bu dosyayı installer ile birlikte GitHub Release\'e yükleyin.');
