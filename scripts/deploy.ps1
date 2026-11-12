# 更新正式環境：拉取最新程式、安裝相依套件、建置、重啟。在正式環境的資料夾內執行。
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
Write-Output "已更新並重啟。"
