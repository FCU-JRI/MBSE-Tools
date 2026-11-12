# 註冊「登入時自動啟動」的排程工作。不需要系統管理員權限。
# 這台電腦重開機後要有人登入 Windows，網站才會起來（可在 Windows 設定自動登入）。
param([string]$DataDir = "D:\JRI MBSE Data", [string]$TaskName = "JRI MBSE")
$script = Join-Path $PSScriptRoot "run-server.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -DataDir `"$DataDir`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "JRI MBSE 網頁工具" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Output "已註冊並啟動排程工作「$TaskName」。"
