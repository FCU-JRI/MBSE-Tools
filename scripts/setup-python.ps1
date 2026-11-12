# 建立飛行模擬用的 Python 環境（RocketPy）。需要先安裝 Python 3.12。
param([string]$DataDir = "D:\JRI MBSE Data")
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
if (-not (Test-Path $py)) { $py = (Get-Command python -ErrorAction Stop).Source }
$venv = Join-Path $DataDir "pyenv"
& $py -m venv $venv
& (Join-Path $venv "Scripts\python.exe") -m pip install --quiet --disable-pip-version-check -r (Join-Path $root "sim\requirements.txt")
& (Join-Path $venv "Scripts\python.exe") -c "from importlib import metadata; print('rocketpy', metadata.version('rocketpy'))"
