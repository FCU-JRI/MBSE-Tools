# 啟動 JRI MBSE 伺服器並在它結束時自動重啟。由排程工作在登入時執行。
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
  Add-Content $log ("[" + (Get-Date -Format "s") + "] 啟動伺服器")
  & $node "server/index.ts" *>> $log
  Add-Content $log ("[" + (Get-Date -Format "s") + "] 伺服器結束（代碼 $LASTEXITCODE），5 秒後重啟")
  # 只保留最近 30 天的紀錄
  Get-ChildItem $logDir -Filter "server-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 5
}
