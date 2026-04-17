/**
 * Builds the Caller ID SDK helper used by packaged Electron releases.
 * The helper is optional at runtime, but release builds should make the
 * packaged expectation explicit instead of silently shipping without it.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const helperRoot = path.join(root, 'tools', 'callerid-sdk-helper');
const csproj = path.join(helperRoot, 'CallerIdSdkHelper.csproj');
const outputDir = path.join(helperRoot, 'bin', 'Release', 'net8.0');
const exePath = path.join(outputDir, 'CallerIdSdkHelper.exe');

function copyDirIfExists(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDirIfExists(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

if (!fs.existsSync(csproj)) {
  console.error(`[build-callerid-helper] FAIL: proje bulunamadi: ${csproj}`);
  process.exit(1);
}

const dotnetCheck = spawnSync('dotnet', ['--version'], {
  cwd: root,
  encoding: 'utf8',
  shell: true,
});

if (dotnetCheck.status !== 0) {
  if (fs.existsSync(exePath)) {
    console.warn('[build-callerid-helper] dotnet bulunamadi; mevcut Release helper kullaniliyor:', exePath);
    process.exit(0);
  }
  console.error('[build-callerid-helper] FAIL: dotnet SDK bulunamadi ve mevcut CallerIdSdkHelper.exe yok.');
  console.error('[build-callerid-helper] .NET 8 SDK kurun veya helper exe dosyasini Release klasorune uretin.');
  process.exit(1);
}

console.log(`[build-callerid-helper] dotnet ${String(dotnetCheck.stdout || '').trim()}`);

// Use `dotnet publish` with self-contained win-x64 so the resulting .exe
// does not require the .NET runtime on the target machine.
// Output is placed directly into bin/Release/net8.0/ so extraResources and
// preflight paths stay unchanged.
const publishArgs = [
  'publish',
  csproj,
  '-c',
  'Release',
  '-r',
  'win-x64',
  '--self-contained',
  'true',
  '-o',
  outputDir,
  '--nologo',
  '-p:RestoreFallbackFolders=',
  '-p:RestoreAdditionalProjectFallbackFolders=',
  '-p:DisableImplicitNuGetFallbackFolder=true',
];

const build = spawnSync('dotnet', publishArgs, {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

if (build.status !== 0 || build.error) {
  if (build.error) console.error(build.error);
  if (fs.existsSync(exePath)) {
    console.warn('[build-callerid-helper] WARN: dotnet publish basarisiz oldu; mevcut Release helper kullaniliyor.');
    console.warn('[build-callerid-helper] WARN: release makinesinde .NET/NuGet ortamini duzeltin ve helper build logunu kontrol edin.');
  } else {
    process.exit(build.status || 1);
  }
}

copyDirIfExists(path.join(helperRoot, 'cidshow_x64'), path.join(outputDir, 'cidshow_x64'));
copyDirIfExists(path.join(helperRoot, 'cidshow_x86'), path.join(outputDir, 'cidshow_x86'));

if (!fs.existsSync(exePath)) {
  console.error(`[build-callerid-helper] FAIL: beklenen exe uretilmedi: ${exePath}`);
  process.exit(1);
}

console.log('[build-callerid-helper] OK:', exePath);
