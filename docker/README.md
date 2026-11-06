# Docker commands and cron

The image runs the compiled CLI. Use `app` for one-off commands, `app-cron`
for schedules, or `app-loop` for a delay between runs. The app services wait
for Postgres to be healthy, and persist `logs/` and `tmp/` to the host.

## Setup and one-off commands

Run from the project directory:

```sh
docker compose build app app-cron
docker compose up -d postgres
npm run migrate-up
docker compose run --rm -T app help
docker compose run --rm -T app releases.categories.missing.label ArtistShare tmp/artistshare_missing_category_albums.txt
```

`npm run migrate-up` requires Goose installed on the host. The image does not
include Goose or automatically apply migrations. Existing databases must have
the current migrations applied before running jobs. Compose passes the API key
and other configured settings from the project's `.env` file.

`app` has the `manual` profile and no restart policy, so starting the cron
profile does not also launch the default artist scraper. Explicitly naming
`app` in `docker compose run` enables it automatically.

## Schedule multiple commands inside Docker

Edit `docker/cron-jobs.conf`. Each active line has five numeric cron fields
followed by a shell command; omit the username. For example:

```cron
*/30 * * * * node /app/build/index.js releases.rescrape 200
15 2 * * * node /app/build/index.js releases.categories.missing.label "ArtistShare" tmp/artistshare_missing_category_albums.txt
```

Then start the scheduler:

```sh
docker compose --profile cron up -d app-cron
docker compose logs app-cron
tail -f logs/cron.log
```

Schedules use UTC with the default image. Jobs run from `/app` with the
container's environment. Quotes, repeated spaces in arguments, and literal
percent signs are preserved. A job skips a tick if its previous run is still
active; different scheduled lines can run concurrently. Job output, timestamps,
and exit codes go to `logs/cron.log`. Rotate or prune that log as needed.

The checked-in jobs file contains only comments. With no active lines, the
scheduler uses `CRON_SCHEDULE` (default `*/30 * * * *`) and `CRON_COMMAND`
(default `node /app/build/index.js artists`). Set those in `.env` to use a
single command, or add active lines for multiple commands.

Restart after editing the jobs file:

```sh
docker compose restart app-cron
```

If you change `.env`, recreate the service instead:

```sh
docker compose --profile cron up -d --force-recreate app-cron
```

Rebuild with `--build` after source changes. Stop schedules with
`docker compose stop app-cron`.

## Use an existing host crontab instead

Keep Postgres running and build the image first. On a Linux host with Docker
at `/usr/bin/docker`, a crontab entry could be:

```cron
15 2 * * * cd /absolute/path/to/moosicgraff && /usr/bin/flock -n /tmp/moosicgraff-artistshare.lock /usr/bin/docker compose run --rm -T app releases.categories.missing.label ArtistShare tmp/artistshare_missing_category_albums.txt >> logs/artistshare-cron.log 2>&1
```

Use the actual absolute paths on your host. `-T` disables interactive terminal
allocation. Host cron uses the host's timezone. Choose either host cron or
`app-cron` for a given job to avoid scheduling it twice.

References: [Compose one-off commands](https://docs.docker.com/reference/cli/docker/compose/run/),
[dependency readiness](https://docs.docker.com/compose/how-tos/startup-order/),
and [Debian cron syntax](https://manpages.debian.org/bookworm/cron/crontab.5.en.html).

## Local checks

```sh
npx tsc --noEmit
docker compose --profile cron config --quiet
node --test docker/tests/cron.test.cjs
```

The cron tests isolate filesystem paths and stub the cron daemon and `flock`.
They verify command and environment handling, logging, and the skip behavior
when a lock is held. They do not replace a smoke test in the Linux image.
