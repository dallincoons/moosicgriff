import {ChildProcess, spawn} from "node:child_process";
import {Duplex} from "node:stream";

const connections = new Set<ChildProcess>();

export function sshArguments(destination: string, host: string, port: number): string[] {
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(destination)) {
        throw new Error("DB_SSH_HOST must be a user@host SSH destination");
    }
    // The database is bound only to the server's loopback interface.
    if (host !== "127.0.0.1" || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("SSH database URLs must use 127.0.0.1 and a valid server port");
    }
    return [
        "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
        "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15",
        "-o", "ServerAliveCountMax=3", "-W", `${host}:${port}`, destination,
    ];
}

/** Postgres.js supports custom socket-like duplex streams, including SSH. */
export function createSshSocket(destination: string, host: string, port: number): Duplex {
    const child = spawn("ssh", sshArguments(destination, host, port), {stdio: "pipe"});
    const socket = Duplex.from({readable: child.stdout!, writable: child.stdin!});
    // Postgres.js uses readyState to send its termination message during shutdown.
    Object.defineProperty(socket, "readyState", {
        get: () => socket.destroyed || socket.writableEnded ? "closed" : "open",
    });
    connections.add(child);
    let errors = "";
    child.stderr!.on("data", data => { errors = (errors + data.toString()).slice(-2048); });
    child.on("error", error => socket.destroy(error));
    child.on("close", code => {
        connections.delete(child);
        if (code && !socket.destroyed) {
            socket.destroy(new Error(`SSH database connection failed (exit ${code}): ${errors.trim()}`));
        }
    });
    socket.on("close", () => {
        if (child.exitCode === null) child.kill();
        connections.delete(child);
    });
    return socket;
}

export function closeSshSockets(): void {
    for (const child of connections) child.kill();
    connections.clear();
}

process.once("exit", closeSshSockets);
