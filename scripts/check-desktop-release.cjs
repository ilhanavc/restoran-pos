/**
 * Fast preflight for desktop packaging inputs.
 * This does not build the installer; it verifies that the release layout has
 * the files Electron main expects on a clean Windows machine.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const checks = [
  ['client build', path.join(root, 'client', 'dist', 'index.html')],
  ['server entry', path.join(root, 'server', 'index.js')],
  ['server package', path.join(root, 'server', 'package.json')],
  ['server sqlite native module', path.join(root, 'server', 'node_modules', 'better-sqlite3')],
  ['store bridge entry', path.join(root, 'store-bridge', 'index.js')],
  ['store bridge dependencies', path.join(root, 'store-bridge', 'node_modules')],
  ['caller id helper exe', path.join(root, 'tools', 'callerid-sdk-helper', 'bin', 'Release', 'net8.0', 'CallerIdSdkHelper.exe')],
  ['caller id x64 dll', path.join(root, 'tools', 'callerid-sdk-helper', 'cidshow_x64', 'cid.dll')],
];

let failed = false;
for (const [label, filePath] of checks) {
  const ok = fs.existsSync(filePath);
  console.log(`[desktop-preflight] ${ok ? 'OK  ' : 'FAIL'} ${label}: ${filePath}`);
  if (!ok) failed = true;
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const build = pkg.build || {};
if (build.asar === false) {
  console.warn('[desktop-preflight] WARN: asar=false; packaged app will be larger and less tidy.');
}
if (!build.extraResources) {
  console.error('[desktop-preflight] FAIL: build.extraResources tanimli degil.');
  failed = true;
}

if (failed) {
  console.error('[desktop-preflight] FAIL: desktop release girdileri eksik.');
  process.exit(1);
}

console.log('[desktop-preflight] OK: desktop release girdileri hazir.');
