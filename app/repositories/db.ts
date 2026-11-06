import postgres from "postgres";
import {DB_SSH_HOST, DB_STRING} from "config";
import {closeSshSockets, createSshSocket} from "./sshsocket";
import {Duplex} from "node:stream";

const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 20;
const DEFAULT_MAX_LIFETIME_SECONDS = 60 * 30;
const DEFAULT_STATEMENT_TIMEOUT_MS = 60_000;
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const options: postgres.Options<{}> & {socket?: () => Duplex} = {
    connect_timeout: parsePositiveInt(process.env.DB_CONNECT_TIMEOUT_SECONDS, DEFAULT_CONNECT_TIMEOUT_SECONDS),
    idle_timeout: parsePositiveInt(process.env.DB_IDLE_TIMEOUT_SECONDS, DEFAULT_IDLE_TIMEOUT_SECONDS),
    max_lifetime: parsePositiveInt(process.env.DB_MAX_LIFETIME_SECONDS, DEFAULT_MAX_LIFETIME_SECONDS),
    max: parsePositiveInt(process.env.DB_MAX_CONNECTIONS, DB_SSH_HOST ? 4 : 10),
    connection: {
        statement_timeout: parsePositiveInt(process.env.DB_STATEMENT_TIMEOUT_MS, DEFAULT_STATEMENT_TIMEOUT_MS),
        lock_timeout: parsePositiveInt(process.env.DB_LOCK_TIMEOUT_MS, DEFAULT_LOCK_TIMEOUT_MS),
    },
};

if (DB_SSH_HOST) {
    const destination = DB_SSH_HOST;
    const url = new URL(DB_STRING);
    options.socket = () => createSshSocket(destination, url.hostname, Number(url.port || 5432));
}

export const db = postgres(DB_STRING, options);

export async function closeDb(): Promise<void> {
    try {
        await db.end({ timeout: 5 });
    } finally {
        closeSshSockets();
    }
}
