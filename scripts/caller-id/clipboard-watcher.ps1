# Deprecated compatibility shim.
# Yeni script: .\scripts\callerid-clipboard-listener.ps1

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Resolve-Path (Join-Path $scriptDir "..\..")
$newScript = Join-Path $rootDir "scripts\callerid-clipboard-listener.ps1"

Write-Warning "[deprecated] scripts/caller-id/clipboard-watcher.ps1 yerine scripts/callerid-clipboard-listener.ps1 kullanin."
& powershell -ExecutionPolicy Bypass -File $newScript
