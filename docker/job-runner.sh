#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  echo "[job-runner] missing command. example: /app/docker/job-runner.sh artists"
  exit 1
fi

echo "[job-runner] running: node /app/build/index.js $*"
cd /app
node /app/build/index.js "$@"
