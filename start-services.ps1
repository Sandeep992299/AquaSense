# ============================================================
# AquaSense – Local Dev Startup Script
# Starts all 4 microservices with correct working directories.
#
# Usage:  .\start-services.ps1
#         .\start-services.ps1 -Stop     # kill all node processes
# ============================================================
param([switch]$Stop)

$base = "$PSScriptRoot\services"

if ($Stop) {
  Write-Host "`n[aquasense] Stopping all Node.js processes..." -ForegroundColor Yellow
  Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
  Write-Host "[aquasense] Done.`n" -ForegroundColor Green
  exit 0
}

# ── Prerequisite: JWT_SECRET ────────────────────────────────
if (-not $env:JWT_SECRET) {
  $env:JWT_SECRET = "aquasense-dev-secret-CHANGE-IN-PROD"
  Write-Host "[aquasense] JWT_SECRET not set – using dev default" -ForegroundColor Yellow
}

# ── Kill any leftover Node processes ────────────────────────
Write-Host "`n[aquasense] Stopping existing Node processes..." -ForegroundColor Cyan
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# ── Service definitions ─────────────────────────────────────
$services = @(
  @{ name = "user-service";    dir = "user-service";    port = 8081 },
  @{ name = "billing-service"; dir = "billing-service"; port = 8082 },
  @{ name = "usage-service";   dir = "usage-service";   port = 8083 },
  @{ name = "alert-service";   dir = "alert-service";   port = 8084 }
)

# ── Start each service from its own directory ───────────────
Write-Host "[aquasense] Starting services...`n" -ForegroundColor Cyan
$pids = @{}
foreach ($svc in $services) {
  $proc = Start-Process -FilePath "node" -ArgumentList "index.js" `
    -WorkingDirectory "$base\$($svc.dir)" `
    -WindowStyle Hidden -PassThru
  $pids[$svc.name] = $proc.Id
  Write-Host ("  ▶  {0,-20} PID={1}  port={2}" -f $svc.name, $proc.Id, $svc.port)
}

# ── Wait for services to bind ───────────────────────────────
Write-Host "`n[aquasense] Waiting 6 s for all services to bind..." -ForegroundColor Cyan
Start-Sleep -Seconds 6

# ── Health check all services ───────────────────────────────
Write-Host "`n[aquasense] Health checks:`n"
$pass = 0; $fail = 0
foreach ($svc in $services) {
  $url = "http://localhost:$($svc.port)/health"
  try {
    $r = Invoke-RestMethod $url -TimeoutSec 5
    Write-Host ("  ✅  {0,-20} status={1}  db={2}" -f $svc.name, $r.status, $r.db) -ForegroundColor Green
    $pass++
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 503) {
      Write-Host ("  ⚠️   {0,-20} UP (503 = no local DB)" -f $svc.name) -ForegroundColor Yellow
      $pass++
    } else {
      Write-Host ("  ❌  {0,-20} FAILED: {1}" -f $svc.name, $_.Exception.Message) -ForegroundColor Red
      $fail++
    }
  }
}

Write-Host ""
if ($fail -eq 0) {
  Write-Host "[aquasense] 🚀  All $($services.Count) services running!" -ForegroundColor Green
} else {
  Write-Host "[aquasense] ⚠️   $fail service(s) failed to start." -ForegroundColor Red
}

Write-Host @"

  Ports:
    user-service    → http://localhost:8081
    billing-service → http://localhost:8082
    usage-service   → http://localhost:8083
    alert-service   → http://localhost:8084

  Stop:  .\start-services.ps1 -Stop
"@ -ForegroundColor Cyan
