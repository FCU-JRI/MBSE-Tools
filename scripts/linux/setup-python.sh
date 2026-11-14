#!/usr/bin/env bash
# Creates the Python environment used for flight simulation (RocketPy).
# Tested with Python 3.13 on Raspberry Pi OS (Debian 13, aarch64); needs python3-venv.
# Usage: sudo scripts/linux/setup-python.sh [DATA_DIR] [USER]
set -euo pipefail
DATA="${1:-/srv/jri-mbse-data}"
USER_NAME="${2:-jri}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

sudo -u "$USER_NAME" python3 -m venv "$DATA/pyenv"
# Binary wheels only: building numpy/scipy from source on a Pi takes hours.
sudo -u "$USER_NAME" "$DATA/pyenv/bin/pip" install --quiet --disable-pip-version-check \
  --only-binary=:all: -r "$ROOT/sim/requirements.txt"
sudo -u "$USER_NAME" "$DATA/pyenv/bin/python" -c \
  "from importlib import metadata; print('rocketpy', metadata.version('rocketpy'))"
