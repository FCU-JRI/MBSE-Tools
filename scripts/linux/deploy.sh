#!/usr/bin/env bash
# Updates the production copy: stop, pull, install, build, start.
# The server must be fully stopped before "npm ci": reinstalling packages under a running
# server leaves node_modules broken. Any failing step aborts and the old build is started again.
# Usage: sudo scripts/linux/deploy.sh [USER]
set -uo pipefail
USER_NAME="${1:-jri}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

as_user() { sudo -u "$USER_NAME" "$@"; }

systemctl stop jri-mbse
if as_user git -C "$ROOT" pull --ff-only &&
   as_user npm ci --prefix "$ROOT" --no-audit --no-fund &&
   as_user npm run --prefix "$ROOT" build; then
  echo "Updated."
else
  echo "DEPLOY FAILED: see the message above before retrying. Starting the server again."
fi
systemctl start jri-mbse
