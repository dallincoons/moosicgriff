# Source control and production recovery

The two applications are separate repositories. Their worker code is ordinary
source code checked into these repositories, alongside the Docker configuration.

## Moosicgraff

- Source: this repository, `git@github.com:dallincoons/moosicgriff.git`.
- Mac: `/Users/dallincoons/Projects/moosicgraff`.
- Server checkout: `/home/forge/moosicgraff`.
- Worker implementation: `docker/yearly-scheduler.cjs`.
- Production services/resource limits: `docker-compose.yearly.yml`.
- Current production year-list settings: `config/yearly/jobs.json` (tracked).
- Deployment code: `docker/deploy.sh`, `docker/deploy-server.sh`, and
  `docker/apply-server-update.sh`.
- Shared PostgreSQL migration/setup and SSH client:
  `docker/server-database.py`, `docker/REMOTE_DATABASE.md`, and
  `app/repositories/sshsocket.ts`.

Commit changes on the Mac and run `npm run deploy`. The server pulls the commit,
builds/tests an image, and waits for active jobs before replacing workers. Check
`output/yearly/deploy.log` and `output/yearly/deployed-revision` on the server.

## RSS application

The RSS app has its own Git repository at
`/Users/dallincoons/Documents/music-release-rss`. Its source includes:

- RSS worker: `tools/run_interval.py` and `rss_relevance/cli.py`.
- Docker image/services: `Dockerfile`, `compose.yaml`, `compose.server.yaml`.
- Unread history and duplicate grouping: `rss_relevance/inbox.py`.
- Report commands: `tools/report_inbox.py` and `tools/read_report.py`.
- Mac alias installer: `ops/install-report-alias.py`.
- Server setup and recovery: `ops/README.md`.

See that repository's `SOURCE_CONTROL.md` for its remotes and checkout paths.

## Data kept outside Git

| Item | Location | Reason |
| --- | --- | --- |
| Credentials and database URLs | Ignored `.env` files | Private secrets |
| PostgreSQL data | RSS server Docker volume | Mutable application data |
| RSS row archive and seen history | RSS `output/report_inbox.sqlite3` | Mutable private state |
| Reports, job checkpoints, logs | Each project's `output/` and `logs/` | Generated runtime state |
| Private migration backups | Ignored `.deployment/` or `tmp/` | Database and credential backups |

Git records the instructions and code needed to run the apps. It does not back up
the current database or report history. Retain those separately during restores;
never recreate production with `docker compose down -v`. See the operational
runbooks for database backup/restore and service startup.
