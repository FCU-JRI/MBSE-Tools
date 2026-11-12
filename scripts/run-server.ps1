# Runs the JRI MBSE server and restarts it whenever it exits. Started by the scheduled task at logon.
# Keep this file ASCII-only: Windows PowerShell 5.1 misreads UTF-8 without a BOM.
param([string]$DataDir = "D:\JRI MBSE Data")
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:JRI_HOME = $DataDir
$logDir = Join-Path $DataDir "logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$node = (Get-Command node -ErrorAction Stop).Source
while ($true) {
  $log = Join-Path $logDir ("server-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
  Add-Content $log ("[" + (Get-Date -Format "s") + "] starting server")
  & $node "server/index.ts" *>> $log
  Add-Content $log ("[" + (Get-Date -Format "s") + "] server exited (code $LASTEXITCODE), restarting in 5s")
  Get-ChildItem $logDir -Filter "server-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 5
}
