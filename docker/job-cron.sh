#!/bin/sh
set -eu

CRON_SCHEDULE="${CRON_SCHEDULE:-*/30 * * * *}"
CRON_USER="${CRON_USER:-root}"
CRON_FILE="/etc/cron.d/moosicgraff"
CRON_LOG_FILE="${CRON_LOG_FILE:-/app/logs/cron.log}"
CRON_JOBS_FILE="${CRON_JOBS_FILE:-/app/docker/cron-jobs.conf}"
export CRON_LOG_FILE

mkdir -p /app/logs /app/tmp /run/moosicgraff
chmod 0700 /run/moosicgraff
umask 077

# Debian cron does not pass the container environment to jobs. Save it using
# shell quoting so spaces, quotes, dollar signs and newlines survive unchanged.
node <<'NODE'
const fs = require('node:fs');
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
const exports = Object.entries(process.env)
  .filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
  .map(([name, value]) => `export ${name}=${quote(value)}\n`)
  .join('');
fs.writeFileSync('/run/moosicgraff/environment', exports, { mode: 0o600 });
NODE

cat > "$CRON_FILE" <<EOF
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EOF

add_job() {
  schedule="$1"
  command="$2"
  # Store commands outside the crontab so cron does not reinterpret percent
  # signs, including those inside Wikipedia URLs.
  added_jobs=$((added_jobs + 1))
  printf '%s\n' "$command" > "/run/moosicgraff/job-$added_jobs.sh"
  printf '%s %s /app/docker/job-cron-exec.sh %s\n' \
    "$schedule" "$CRON_USER" "$added_jobs" >> "$CRON_FILE"
}

added_jobs=0
if [ -f "$CRON_JOBS_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    trimmed=$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    case "$trimmed" in
      ''|\#*) continue ;;
    esac

    if ! printf '%s\n' "$trimmed" | awk '
      NF < 6 { exit 1 }
      { for (i = 1; i <= 5; i++) if ($i !~ /^[0-9*,\/-]+$/) exit 1 }
    '; then
      echo "[job-cron] invalid job in $CRON_JOBS_FILE: $trimmed" >&2
      exit 1
    fi
    schedule=$(printf '%s\n' "$trimmed" | awk '{print $1" "$2" "$3" "$4" "$5}')
    command=$(printf '%s\n' "$trimmed" | sed -E 's/^([^[:space:]]+[[:space:]]+){5}//')
    add_job "$schedule" "$command"
  done < "$CRON_JOBS_FILE"
else
  echo "[job-cron] jobs file not found: $CRON_JOBS_FILE" >&2
  exit 1
fi

if [ "$added_jobs" -eq 0 ]; then
  add_job "$CRON_SCHEDULE" "${CRON_COMMAND:-node /app/build/index.js artists}"
  echo "[job-cron] mode=single schedule=\"$CRON_SCHEDULE\" user=$CRON_USER log=$CRON_LOG_FILE"
else
  echo "[job-cron] mode=multi jobs_file=$CRON_JOBS_FILE jobs=$added_jobs user=$CRON_USER log=$CRON_LOG_FILE"
fi

chmod 0644 "$CRON_FILE"
exec cron -f
