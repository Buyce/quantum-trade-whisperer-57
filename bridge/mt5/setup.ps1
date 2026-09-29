param(
  [string]$Python = "py"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $Root "..\..")
$Venv = Join-Path $Root ".venv"
$PythonExe = Join-Path $Venv "Scripts\python.exe"

Write-Host "P-Trades Direct MT5 Bridge (read-only)" -ForegroundColor Cyan
Write-Host "MetaTrader 5 must already be installed, open and logged into the intended account."
Write-Host ""

if (-not (Test-Path $PythonExe)) {
  & $Python -m venv $Venv
}
& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install -r (Join-Path $Root "requirements.txt")

$BridgeId = Read-Host "Bridge ID"
$SecureToken = Read-Host "Bridge token (input hidden)" -AsSecureString
$IngestUrl = Read-Host "P-Trades ingest URL"

$Ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
try {
  $PlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Ptr)
  $env:P_TRADES_BRIDGE_ID = $BridgeId
  $env:P_TRADES_BRIDGE_TOKEN = $PlainToken
  $env:P_TRADES_BRIDGE_INGEST_URL = $IngestUrl
  $env:P_TRADES_BRIDGE_INTERVAL_SECONDS = "5"

  Write-Host ""
  Write-Host "Starting read-only bridge. No order_send capability exists in this release." -ForegroundColor Green
  Push-Location $RepoRoot
  try {
    & $PythonExe (Join-Path $Root "agent.py")
  } finally {
    Pop-Location
  }
} finally {
  if ($Ptr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Ptr)
  }
  Remove-Item Env:P_TRADES_BRIDGE_TOKEN -ErrorAction SilentlyContinue
}
