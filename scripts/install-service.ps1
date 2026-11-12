# Registers a scheduled task that starts the server when this user logs on. No admin rights needed.
# After a reboot someone must log on to Windows before the site comes up.
# Keep this file ASCII-only.
param([string]$DataDir = "D:\JRI MBSE Data", [string]$TaskName = "JRI MBSE")
$script = Join-Path $PSScriptRoot "run-server.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -DataDir `"$DataDir`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "JRI MBSE web tool" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Output "Scheduled task '$TaskName' registered and started."
