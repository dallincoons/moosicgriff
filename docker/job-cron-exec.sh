#!/bin/sh
set -eu

. /run/moosicgraff/environment
cd /app
mkdir -p "$(dirname "$CRON_LOG_FILE")"
exec >> "$CRON_LOG_FILE" 2>&1

job_id="${1:-1}"
case "$job_id" in
  ''|*[!0-9]*) echo "[job-cron-exec] invalid job id"; exit 1 ;;
esac

# Each scheduled line has its own lock. A crash automatically releases it;
# different jobs can still run concurrently.
exec 9> "/run/moosicgraff/job-$job_id.lock"
if ! flock -n 9; then
  echo "[job-cron-exec] job=$job_id skipped=already_running"
  exit 0
fi

echo "[job-cron-exec] job=$job_id start=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
status=0
/bin/sh "/run/moosicgraff/job-$job_id.sh" || status=$?
echo "[job-cron-exec] job=$job_id end=$(date -u +%Y-%m-%dT%H:%M:%SZ) exit=$status"
exit "$status"
