"""Initialize the shared primary DB on the RSS server; never print credentials.

Run from /home/forge/music-release-rss. Restore the source dump between `init`
and `activate`. The existing lookup database and source Mac database are retained.
"""
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

ROOT = Path.cwd()
ENV = ROOT / ".env"


def sql(database, statement):
    result = subprocess.run([
        "sh", "ops/compose-server.sh", "exec", "-T", "lookup-db", "psql", "-X", "-q",
        "-U", "rss_admin", "-d", database, "-v", "ON_ERROR_STOP=1",
    ], input=statement, text=True, capture_output=True)
    if result.returncode:
        # SQL errors can echo statements; redact all environment values containing passwords.
        message = result.stderr
        for key, value in values().items():
            if "PASSWORD" in key or "URL" in key:
                message = message.replace(value, "<redacted>")
        raise SystemExit(message)
    return result.stdout


def values():
    return dict(line.split("=", 1) for line in ENV.read_text().splitlines()
                if line and not line.startswith("#"))


def save_private(path, content, exclusive=False):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC), 0o600)
    with os.fdopen(descriptor, "w") as handle:
        handle.write(content)


def initialize():
    settings = values()
    backup = ROOT / ".deployment/env-before-primary"
    if not backup.exists():
        save_private(backup, ENV.read_text(), exclusive=True)
    password = settings.get("MOOSICGRAFF_DB_PASSWORD") or secrets.token_hex(32)
    if not re.fullmatch(r"[0-9a-f]{64}", password):
        raise SystemExit("Unexpected writer password format")
    if "MOOSICGRAFF_DB_PASSWORD" not in settings:
        save_private(ENV, ENV.read_text().rstrip() + f"\nMOOSICGRAFF_DB_PASSWORD={password}\n")
    sql("postgres", rf"""
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'moosicgraff_app') THEN
        CREATE ROLE moosicgraff_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;
END $$;
ALTER ROLE moosicgraff_app WITH PASSWORD '{password}' CONNECTION LIMIT 8;
ALTER ROLE moosicgraff_app SET statement_timeout = '60s';
ALTER ROLE moosicgraff_app SET lock_timeout = '10s';
SELECT 'CREATE DATABASE moosicgraff OWNER moosicgraff_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'moosicgraff')\gexec
REVOKE ALL ON DATABASE moosicgraff FROM PUBLIC;
GRANT CONNECT ON DATABASE moosicgraff TO moosicgraff_app;
""")
    save_private(ROOT / ".deployment/moosicgraff-client.env",
                 f"GOOSE_DBSTRING=postgresql://moosicgraff_app:{password}@127.0.0.1:55432/moosicgraff\n"
                 "DB_SSH_HOST=forge@142.93.6.169\nDB_MAX_CONNECTIONS=4\n")
    print("Created primary database/writer role and private client settings")


def activate():
    # Refuse to switch the RSS connection until all required data has been restored.
    sql("moosicgraff", """
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM public.artists) OR NOT EXISTS (SELECT FROM public.labels)
       OR NOT EXISTS (SELECT FROM public.releases) THEN
        RAISE EXCEPTION 'Primary database has not been populated';
    END IF;
END $$;
GRANT CONNECT ON DATABASE moosicgraff TO rss_reader;
GRANT USAGE ON SCHEMA public TO rss_reader;
GRANT SELECT ON public.artists, public.labels TO rss_reader;
ALTER ROLE rss_reader SET default_transaction_read_only = on;
""")
    lines = ENV.read_text().splitlines()
    lines = [line.replace("/music_release_lookup", "/moosicgraff")
             if line.startswith("RSS_DATABASE_URL=") else line for line in lines]
    save_private(ENV, "\n".join(lines) + "\n")
    print("RSS now configured to read artists/labels from the shared primary database")


if sys.argv[1:] == ["init"]:
    initialize()
elif sys.argv[1:] == ["activate"]:
    activate()
else:
    raise SystemExit("Usage: python3 server-database.py init|activate")
