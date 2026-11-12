# Updates the production copy: pull, install, build, restart. Run from the production folder.
# Keep this file ASCII-only.
param([string]$TaskName = "JRI MBSE")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
git pull --ff-only
npm ci
npm run build
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*server/index.ts*" -and $_.CommandLine -notlike "*--test*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-ScheduledTask -TaskName $TaskName
Write-Output "Updated and restarted."
