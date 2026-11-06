#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p output/yearly
exec 9>output/yearly/deploy.lock
if ! flock -n 9; then
  echo "A deployment is already running." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "Server checkout has local changes; refusing to overwrite them." >&2
  exit 1
fi
git pull --ff-only origin main
exec sh docker/apply-server-update.sh
