param(
  [string]$ApiBase = $env:API_BASE,
  [string]$BridgeToken = $env:BRIDGE_TOKEN,
  [string]$SourceType = $(if ($env:CALLERID_SOURCE_TYPE) { $env:CALLERID_SOURCE_TYPE } else { "callerid_clipboard" }),
  [int]$PollMs = $(if ($env:CALLERID_POLL_MS) { [int]$env:CALLERID_POLL_MS } else { 300 }),
  [int]$DebounceMs = $(if ($env:CALLERID_DEBOUNCE_MS) { [int]$env:CALLERID_DEBOUNCE_MS } else { 4000 })
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ApiBase)) {
  $ApiBase = "http://127.0.0.1:3001/api"
}
if ([string]::IsNullOrWhiteSpace($BridgeToken)) {
  throw "Bridge token gerekli. Parametre: -BridgeToken veya env: BRIDGE_TOKEN"
}
if ([string]::IsNullOrWhiteSpace($SourceType)) {
  $SourceType = "callerid_clipboard"
}
if ($PollMs -lt 100) { $PollMs = 100 }
if ($DebounceMs -lt 0) { $DebounceMs = 0 }

$ApiBase = $ApiBase.TrimEnd("/")
$endpoint = "$ApiBase/bridge/caller-id/incoming"
$headers = @{
  "Content-Type" = "application/json"
  "X-Bridge-Token" = $BridgeToken
}

$lastDigits = ""
$lastSentAt = [DateTime]::MinValue

Write-Host "[callerid-clipboard] started endpoint=$endpoint source_type=$SourceType pollMs=$PollMs debounceMs=$DebounceMs"

while ($true) {
  try {
    $clip = Get-Clipboard -Raw
    if (-not [string]::IsNullOrWhiteSpace($clip)) {
      $digits = ($clip -replace "\D", "")
      $isPhone = ($digits.Length -eq 10 -or $digits.Length -eq 11)
      if ($isPhone) {
        $now = Get-Date
        $elapsed = ($now - $lastSentAt).TotalMilliseconds
        $sameAsLast = ($digits -eq $lastDigits)
        $debounced = $sameAsLast -and $elapsed -lt $DebounceMs
        if (-not $debounced) {
          $payload = @{
            phone = $digits
            source_type = $SourceType
            raw_payload = @{
              clipboard = $clip
              digits = $digits
              captured_at = $now.ToString("o")
            }
          } | ConvertTo-Json -Depth 5

          $res = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -Body $payload
          $lastDigits = $digits
          $lastSentAt = $now
          Write-Host "[callerid-clipboard] sent phone=$digits call_log_id=$($res.callLogId)"
        }
      }
    }
  } catch {
    Write-Warning "[callerid-clipboard] error: $($_.Exception.Message)"
  }

  Start-Sleep -Milliseconds $PollMs
}
