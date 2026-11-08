# Shared server database

Production Moosicgraff data lives in the `moosicgraff` database inside the RSS
server's Postgres container on `forge@142.93.6.169`. Local TypeScript commands and
the server RSS worker use the same artist and label rows. Releases, yearly album
references, and scrape state also live in this database.

The Mac's ignored `.env` contains the remote application URL and:

```dotenv
DB_SSH_HOST=forge@142.93.6.169
DB_MAX_CONNECTIONS=4
```

The URL uses `127.0.0.1:55432/moosicgraff` with the `moosicgraff_app` role and a
private generated password. When `DB_SSH_HOST` is set, that address is interpreted
on the SSH server. Postgres.js opens SSH streams automatically using the normal
Mac SSH configuration/keys and a trusted host key. No separate tunnel command or
Mac listening port is needed. Server Postgres publishes only on server loopback.

Run commands normally:

```sh
npx esrun index.ts db.status
npx esrun index.ts yearly.albums.missing 2026 full
```

If a run printed `[yearly.albums.sync] complete.` before the missing-list query
failed, the sync is already saved. Retry only the list query with the same year:

```sh
npx esrun index.ts yearly.albums.missing 2003 full no-sync
```

The missing-list query normalizes that year's references once and uses reusable
hash lookups. It keeps the normal 60-second statement timeout; no database setting
or schema change is needed.

`db.status` reports the connected database, role, SSH destination, and row counts
without printing credentials. Database writes happen directly on the server;
RSS reads them on its next lookup. If SSH or Postgres is unavailable, the command
fails. There is no automatic local fallback or copy synchronization.

The application role owns the Moosicgraff database and its restored objects,
without superuser, role-creation, or database-creation permissions. RSS retains
SELECT access to only `artists` and `labels`, with read-only transactions.

## Deployment and backups

Server project: `/home/forge/music-release-rss`. Use `sh ops/compose-server.sh`
there. The `lookup-db` service's named volume now stores the full primary DB;
keep the volume when recreating services. Never run `down -v` on production.

The initial migration used a full `pg_dump -Fc --no-owner --no-acl`, restored into
a new database in a single transaction with `--role=moosicgraff_app`. All eight
tables were compared using counts and row-data fingerprints before cutover.
`docker/server-database.py` initializes the writer role/database and activates the
RSS reader connection; it runs from the server RSS project directory. Restore the
dump between its `init` and `activate` actions. Source/server credentials and the
pre-cutover RSS environment remain private.

Private migration backups are retained at:

- Mac: `tmp/moosicgraff-primary.dump` and `tmp/env-before-remote-primary`.
- Server: `.deployment/moosicgraff-primary.dump` and `.deployment/env-before-primary`.

The Mac's original `moosicgraff-postgres-1` database remains untouched as a fallback.
The old server `music_release_lookup` database also remains in place. These are
cutover snapshots and do not receive future writes. Restoring either requires an
explicit configuration change and loses changes made afterward unless those are
transferred first.

The existing Moosicgraff Docker Compose development services and `migrate-up`
package script explicitly target the local development database. For production
migrations, use the server database through SSH and take a fresh server backup
first; do not assume those development commands migrate production.
