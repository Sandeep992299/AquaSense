# AquaSense – Lambda Teams Alert Packager
# Run from repo root:  .\services\lambda\teams-alert\package.ps1

$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot   = Resolve-Path "$ScriptDir\..\..\..\"
$BuildDir   = "$ScriptDir\build"
$ZipPath    = "$ScriptDir\teams_alert_lambda.zip"

Write-Host "=== AquaSense Teams Alert Lambda Packager ===" -ForegroundColor Cyan
Write-Host "  Source : $ScriptDir"
Write-Host "  Output : $ZipPath"

# 1. Clean build dir
if (Test-Path $BuildDir) { Remove-Item -Recurse -Force $BuildDir }
New-Item -ItemType Directory $BuildDir | Out-Null

# 2. Copy lambda source
Copy-Item "$ScriptDir\lambda_function.py" "$BuildDir\"

# 3. Install dependencies into build dir
#    (boto3 is pre-installed in the Lambda runtime but adding for completeness)
Write-Host "`nInstalling dependencies..." -ForegroundColor Yellow
pip install --quiet --target $BuildDir -r "$ScriptDir\requirements.txt"

# 4. Zip contents
Write-Host "`nCreating ZIP..." -ForegroundColor Yellow
if (Test-Path $ZipPath) { Remove-Item $ZipPath }

Push-Location $BuildDir
Compress-Archive -Path * -DestinationPath $ZipPath
Pop-Location

$ZipSize = [math]::Round((Get-Item $ZipPath).Length / 1KB, 1)
Write-Host "`n✅ Package created: $ZipPath ($ZipSize KB)" -ForegroundColor Green
Write-Host "   Use this path in Terraform: var.lambda_zip_path = `"$ZipPath`""
