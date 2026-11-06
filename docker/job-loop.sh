#!/bin/sh
set -eu

INTERVAL_SECONDS="${JOB_INTERVAL_SECONDS:-300}"

if [ "$#" -eq 0 ]; then
  echo "[job-loop] missing command. example: /app/docker/job-loop.sh artists"
  exit 1
fi

if ! echo "$INTERVAL_SECONDS" | grep -Eq '^[0-9]+$'; then
  echo "[job-loop] JOB_INTERVAL_SECONDS must be an integer. got: $INTERVAL_SECONDS"
  exit 1
fi

if [ "$INTERVAL_SECONDS" -lt 1 ]; then
  echo "[job-loop] JOB_INTERVAL_SECONDS must be >= 1. got: $INTERVAL_SECONDS"
  exit 1
fi

echo "[job-loop] interval_seconds=$INTERVAL_SECONDS command=$*"

while true; do
  echo "[job-loop] start=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if /app/docker/job-runner.sh "$@"; then
    echo "[job-loop] status=success"
  else
    echo "[job-loop] status=failed"
  fi

  echo "[job-loop] sleeping=${INTERVAL_SECONDS}s"
  sleep "$INTERVAL_SECONDS"
done
