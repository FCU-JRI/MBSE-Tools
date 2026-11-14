#!/usr/bin/env bash
# Registers and starts the jri-mbse systemd service. Run once after the first build.
# Usage: sudo scripts/linux/install-service.sh [DATA_DIR] [USER]
set -euo pipefail
DATA="${1:-/srv/jri-mbse-data}"
USER_NAME="${2:-jri}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"

sed -e "s|@ROOT@|$ROOT|g" -e "s|@DATA@|$DATA|g" -e "s|@USER@|$USER_NAME|g" -e "s|@HOME@|$HOME_DIR|g" \
  "$ROOT/scripts/linux/jri-mbse.service" > /etc/systemd/system/jri-mbse.service
systemctl daemon-reload
systemctl enable --now jri-mbse
systemctl --no-pager --lines=5 status jri-mbse
