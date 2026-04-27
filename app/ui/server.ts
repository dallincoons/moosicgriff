import { createServer } from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ChildProcess, spawn } from "child_process";

type CommandHelpEntry = {
    section: string;
    name: string;
    description: string;
};

type ParsedCommand = {
    section: string;
    fullName: string;
    command: string;
    description: string;
    placeholders: string[];
};

const HOST = "127.0.0.1";
const PORT = Number(process.env.UI_PORT || 3210);
const INDEX_PATH = resolve(process.cwd(), "app/ui/index.html");
const ESRUN_PATH = resolve(process.cwd(), "node_modules/.bin/esrun");
const CLI_PATH = resolve(process.cwd(), "index.ts");
const POLYFILLS_PATH = resolve(process.cwd(), "app/ui/node-polyfills.cjs");
const activeRuns = new Map<string, ChildProcess>();
let runCounter = 0;
let lastStartedRunId: string | null = null;

function createRunId(): string {
    runCounter += 1;
    return `run_${Date.now()}_${runCounter}`;
}

function runCli(args: string[]): { runId: string; completion: Promise<{ stdout: string; stderr: string; code: number | null }> } {
    const runId = createRunId();
    lastStartedRunId = runId;
    const completion = new Promise<{ stdout: string; stderr: string; code: number | null }>((resolveResult, reject) => {
        const existingNodeOptions = process.env.NODE_OPTIONS || "";
        const requireFlag = `--require ${POLYFILLS_PATH}`;
        const nodeOptions = existingNodeOptions.includes(requireFlag)
            ? existingNodeOptions
            : `${requireFlag} ${existingNodeOptions}`.trim();

        const child = spawn(ESRUN_PATH, [CLI_PATH, ...args], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NODE_OPTIONS: nodeOptions
            }
        });
        activeRuns.set(runId, child);

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString("utf8");
        });

        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
        });

        child.on("error", (error) => {
            activeRuns.delete(runId);
            reject(error);
        });

        child.on("close", (code) => {
            activeRuns.delete(runId);
            resolveResult({ stdout, stderr, code });
        });
    });
    return { runId, completion };
}

function stopRun(runId: string): { stopped: boolean; message: string } {
    const child = activeRuns.get(runId);
    if (!child || child.killed) {
        return { stopped: false, message: "No active run found for runId." };
    }

    const signaled = child.kill("SIGINT");
    setTimeout(() => {
        const activeChild = activeRuns.get(runId);
        if (activeChild && !activeChild.killed) {
            activeChild.kill("SIGKILL");
        }
    }, 5000).unref();

    return {
        stopped: signaled,
        message: signaled ? "Stop signal sent." : "Failed to send stop signal."
    };
}

function stopMostRecentRun(): { stopped: boolean; message: string; runId: string | null } {
    if (!lastStartedRunId) {
        return { stopped: false, message: "No run has been started yet.", runId: null };
    }
    const result = stopRun(lastStartedRunId);
    if (!result.stopped) {
        return { stopped: false, message: "No active run to stop.", runId: null };
    }
    return { ...result, runId: lastStartedRunId };
}

function stopAllActiveRuns(): void {
    for (const runId of activeRuns.keys()) {
        stopRun(runId);
    }
}

function parseCommandHelpFromSource(sourceText: string): CommandHelpEntry[] {
    const entries: CommandHelpEntry[] = [];
    const entryPattern = /\{\s*name:\s*"([^"]+)",\s*description:\s*"([^"]+)",\s*section:\s*"([^"]+)"\s*\}/g;
    let match = entryPattern.exec(sourceText);

    while (match) {
        entries.push({
            name: match[1],
            description: match[2],
            section: match[3]
        });
        match = entryPattern.exec(sourceText);
    }

    return entries;
}

function parseCommandEntries(entries: CommandHelpEntry[]): ParsedCommand[] {
    return entries.map((entry) => {
        const tokens = entry.name.split(/\s+/).filter(Boolean);
        const command = tokens[0] || entry.name;
        const placeholders = entry.name.match(/(<[^>]+>|\[[^\]]+\])/g) || [];
        return {
            section: entry.section,
            fullName: entry.name,
            command,
            description: entry.description,
            placeholders
        };
    });
}

function json(res: import("http").ServerResponse, statusCode: number, payload: unknown): void {
    const text = JSON.stringify(payload);
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(text).toString(),
        "Cache-Control": "no-store"
    });
    res.end(text);
}

function badRequest(res: import("http").ServerResponse, message: string): void {
    json(res, 400, { error: message });
}

async function getCommands(): Promise<ParsedCommand[]> {
    const source = readFileSync(CLI_PATH, "utf8");
    const entries = parseCommandHelpFromSource(source);
    return parseCommandEntries(entries);
}

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

        if (req.method === "GET" && url.pathname === "/") {
            const html = readFileSync(INDEX_PATH, "utf8");
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(html);
            return;
        }

        if (req.method === "GET" && url.pathname === "/api/commands") {
            const commands = await getCommands();
            json(res, 200, { commands });
            return;
        }

        if (req.method === "POST" && url.pathname === "/api/run") {
            const bodyChunks: Buffer[] = [];
            req.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
            req.on("end", async () => {
                try {
                    const payloadRaw = Buffer.concat(bodyChunks).toString("utf8");
                    const payload = JSON.parse(payloadRaw) as { command?: string; args?: string[] };
                    const command = (payload.command || "").trim();
                    const args = Array.isArray(payload.args) ? payload.args : [];

                    if (!command) {
                        badRequest(res, "command is required");
                        return;
                    }

                    const cleanArgs = args.map((arg) => String(arg ?? "").trim()).filter(Boolean);
                    const run = runCli([command, ...cleanArgs]);
                    const result = await run.completion;

                    json(res, 200, {
                        runId: run.runId,
                        command,
                        args: cleanArgs,
                        exitCode: result.code,
                        stdout: result.stdout,
                        stderr: result.stderr
                    });
                } catch (error) {
                    json(res, 500, { error: `Failed to run command: ${String(error)}` });
                }
            });
            return;
        }

        if (req.method === "POST" && url.pathname === "/api/stop") {
            const result = stopMostRecentRun();
            const statusCode = result.stopped ? 200 : 409;
            json(res, statusCode, result);
            return;
        }

        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
    } catch (error) {
        json(res, 500, { error: `Server error: ${String(error)}` });
    }
});

server.listen(PORT, HOST, () => {
    console.log(`MoosicGraff UI running at http://${HOST}:${PORT}`);
});

process.on("SIGINT", () => {
    stopAllActiveRuns();
    process.exit(0);
});

process.on("SIGTERM", () => {
    stopAllActiveRuns();
    process.exit(0);
});
