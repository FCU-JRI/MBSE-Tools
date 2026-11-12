# Updates the production copy: stop, pull, install, build, start. Run from the production folder.
# The server must be fully stopped before "npm ci": reinstalling packages under a running server
# leaves node_modules broken. Any failing step aborts and the old build is started again.
# Keep this file ASCII-only.
param([string]$TaskName = "JRI MBSE")
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Stop-Server {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq "powershell.exe" -and $_.CommandLine -like "*run-server.ps1*") -or
    ($_.Name -eq "node.exe" -and $_.CommandLine -like "*server/index.ts*" -and $_.CommandLine -notlike "*--test*")
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 3
}
function Invoke-Step([string]$Name, [scriptblock]$Body) {
  & $Body
  if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit code $LASTEXITCODE)" }
}

Stop-Server
try {
  Invoke-Step "git pull" { git pull --ff-only }
  Invoke-Step "npm ci" { cmd /c "npm ci" }
  Invoke-Step "build" { cmd /c "npm run build" }
  Write-Output "Updated."
} catch {
  Write-Output "DEPLOY FAILED: $_"
  Write-Output "The server is being started again; check the message above before retrying."
} finally {
  Start-ScheduledTask -TaskName $TaskName
}
