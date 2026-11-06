# Yearly album schedules

Production runs on `forge@142.93.6.169` in `/home/forge/moosicgraff`, using
`docker-compose.yearly.yml`. Both services use the shared server database directly;
the Mac is not involved. These services join the existing private RSS Docker
network and publish no ports.

- `current-year` runs `yearly.albums.missing <current year> full` immediately on
  first startup, then every 12 hours measured from the previous start. The year
  is determined in America/Denver and advances automatically each January.
- `historical-years` runs the configured older years in order, one command at a
  time. It can run alongside `current-year`. Current/future years and duplicate
  years are excluded from this lane.

Each lane and each active year have filesystem locks on the shared persistent
output volume. Runs in one lane never overlap. If a current-year command takes
longer than 12 hours, the next run starts after it finishes. Missed intervals
coalesce into one catch-up run; they do not launch many overdue commands.
Scheduler restarts retain the deadline; an interrupted command is retried on
startup. CLI database writes completed before interruption remain saved.

## Historical list

Edit `config/yearly/jobs.json` **on the server**. This ignored production configuration
is preserved across Git pulls; `docker/yearly/jobs.json` is the tracked initial template:

```json
{
  "historical_years": [2025, 2024, 2021, 2019],
  "historical_repeat": false
}
```

An empty list stays idle. By default, successful years run once and remain marked
complete across restarts. Add a new year to enqueue it. Set `historical_repeat` to
`true` to keep cycling through the list after every year succeeds. Failed years
are retried after an hour; other years can proceed in the meantime. Configuration
is reread between commands, at most 30 seconds after an idle edit. Changes do not
interrupt a running command. To deliberately rerun a completed one-time list,
stop `historical-years`, archive/remove `output/yearly/historical/state.json`, then
start it again. Do not remove lock files while workers are running.

## Operations and output

On the server:

```sh
cd /home/forge/moosicgraff
docker compose -f docker-compose.yearly.yml ps
docker compose -f docker-compose.yearly.yml logs --tail=30
cat output/yearly/current/state.json
cat output/yearly/historical/state.json
```

Each command's stdout and stderr are saved in a new timestamped file under
`output/yearly/current/<year>/` or `output/yearly/historical/<year>/`. State records
the start, finish, next run/retry, exit code, and log filename. Container logs show
start/end summaries. A zero exit code reflects the existing CLI's result; it may
still log individual Wikipedia scraping errors, so inspect command logs for those.

Stop or start a lane by naming it in the Compose command. Restarting an idle
current-year worker does not force an early run. Both workers start after a server
reboot through Docker's restart policy. They each have 0.5 CPU, 768 MB RAM, and a
two-connection DB pool; the current-year worker has a higher relative CPU share.

## Deployment

Copy source excluding `.env*`, `.git`, `node_modules`, `build`, `tmp`, `logs`, and
`output` to the server directory. Create private credentials and persistent folders:

```sh
python3 docker/yearly-server-environment.py
mkdir -p output/yearly logs
docker compose -f docker-compose.yearly.yml config --quiet
```

Build with the existing resource-limited builder, run the Linux lock tests and
database status check in an isolated one-off container, then start both lanes:

```sh
docker buildx build --builder music-release-rss-builder --load \
  -t moosicgraff-yearly:server .
docker buildx stop music-release-rss-builder
docker run --rm --entrypoint node moosicgraff-yearly:server \
  --test docker/tests/yearly-scheduler.test.cjs
docker compose -f docker-compose.yearly.yml run --rm --no-deps \
  --entrypoint node current-year build/index.js db.status
docker compose -f docker-compose.yearly.yml up -d --no-build
```

Preserve the server's ignored `config/yearly/` historical settings during future source syncs. Rebuild and
recreate services after code changes; persistent state and command logs stay on
the host. No local Docker schedule should run these production jobs simultaneously.

## One-command deployment from the Mac

Commit changes on `main`, then run:

```sh
npm run deploy
```

This pushes `main` to GitHub and starts a background deployment on the server. The
server refuses a dirty checkout, pulls with `--ff-only`, builds and tests a new
image with the bounded builder, and checks its database connection. It pauses new
scheduled work, waits for active commands to finish, then recreates the workers
and resumes scheduling. Saved state keeps the current-year deadline. It never
replaces the database volume or changes the RSS service.

Follow deployment progress:

```sh
ssh forge@142.93.6.169 'tail -f /home/forge/moosicgraff/output/yearly/deploy.log'
```

The final `complete revision=...` line confirms deployment; the Git revision is
also recorded in `output/yearly/deployed-revision`. A failed build or test leaves
the running workers in place. Concurrent deployments are rejected by a lock.
The command requires the existing Mac-to-server SSH access and server-to-GitHub
read access. A bare Git push does not deploy; `npm run deploy` initiates both steps.
