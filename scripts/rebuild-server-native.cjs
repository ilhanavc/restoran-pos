/**
 * server/package.json köküne göre better-sqlite3 → mevcut Electron sürümü için yeniden derleme.
 * Varsayılan: önceden derlenmiş (prebuild) ikiliyi Electron için indirir (--build-from-source değil).
 * Kaynak derleme: FORCE_SQLITE_BUILD_FROM_SOURCE=1 ve Visual Studio "Desktop development with C++".
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const electronVer = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
const fromSource = process.env.FORCE_SQLITE_BUILD_FROM_SOURCE === '1';

console.log(
  '[rebuild-server-native] Electron',
  electronVer,
  '→ better-sqlite3',
  fromSource ? '(--build-from-source)' : '(prebuild / electron-rebuild)',
);

const args = [
  '@electron/rebuild',
  '--force',
  '--only',
  'better-sqlite3',
  '--module-dir',
  'server',
  '--version',
  electronVer,
];
if (fromSource) {
  args.push('--build-from-source');
}

const result = spawnSync('npx', args, {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    ...(fromSource ? { npm_config_build_from_source: 'true' } : {}),
  },
});

if (result.status !== 0 && result.status != null) {
  process.exit(result.status);
}
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
