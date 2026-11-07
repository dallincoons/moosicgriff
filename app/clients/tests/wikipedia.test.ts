import * as cheerio from "cheerio";
import { createServer } from "node:http";
import { getHtml } from "app/clients/wikipedia";

jest.mock("cheerio", () => ({ ...jest.requireActual("cheerio"), fromURL: jest.fn() }));
const fromURL = cheerio.fromURL as jest.MockedFunction<typeof cheerio.fromURL>;
const url = "https://en.wikipedia.org/w/index.php?title=Category:2007_albums&pagefrom=At+The+Foot+Of+My+Rival#mw-pages";

describe("Wikipedia HTML fetch retries", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        fromURL.mockReset();
        jest.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it.each([
        ["connection reset", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })],
        ["nested socket failure", new Error("fetch failed", { cause: { code: "UND_ERR_SOCKET" } })],
        ["aggregate timeout", new AggregateError([{ code: "ETIMEDOUT" }])],
        ["body timeout", Object.assign(new Error("body timeout"), { code: "UND_ERR_BODY_TIMEOUT" })],
        ["total timeout", Object.assign(new Error("request timed out"), { name: "TimeoutError" })],
    ])("retries the same page after %s", async (_name, failure) => {
        fromURL.mockRejectedValueOnce(failure).mockResolvedValueOnce(cheerio.load('<a href="/wiki/Next_album">Next album</a>'));
        const result = getHtml(url);
        await jest.runAllTimersAsync();
        expect(await result).toContain("Next album");
        expect(fromURL).toHaveBeenCalledTimes(2);
        for (const call of fromURL.mock.calls) expect(call[0]).toBe(url);
        expect(fromURL.mock.calls[0][1]?.requestOptions).toMatchObject({
            throwOnError: true, maxRedirections: 5, headersTimeout: 30000, bodyTimeout: 30000,
        });
    });

    it.each([429, 500, 502, 503, 504])("retries HTTP %s", async (statusCode) => {
        fromURL.mockRejectedValueOnce({ statusCode }).mockResolvedValueOnce(cheerio.load("Recovered"));
        const result = getHtml(url);
        await jest.runAllTimersAsync();
        expect(await result).toContain("Recovered");
        expect(fromURL).toHaveBeenCalledTimes(2);
    });

    it.each([
        ["7", 7000],
        [["7"], 7000],
        [new Date(Date.UTC(2026, 0, 1, 0, 0, 7)).toUTCString(), 7000],
        ["999999", 60000],
        ["invalid", 1000],
        ["0", 1000],
    ])("uses a bounded Retry-After delay for %s", async (retryAfter, delay) => {
        jest.setSystemTime(Date.UTC(2026, 0, 1));
        fromURL.mockRejectedValueOnce({ statusCode: 429, headers: { "retry-after": retryAfter } })
            .mockResolvedValueOnce(cheerio.load("Recovered"));
        const result = getHtml(url);
        await jest.advanceTimersByTimeAsync(Number(delay) - 1);
        expect(fromURL).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(await result).toContain("Recovered");
    });

    it.each([
        ["404", { statusCode: 404 }], ["403", { statusCode: 403 }],
        ["invalid content type", new RangeError("Invalid content type")],
        ["invalid certificate", { code: "CERT_HAS_EXPIRED" }],
    ])(
        "does not retry permanent failures: %s", async (_name, failure) => {
            fromURL.mockRejectedValue(failure);
            await expect(getHtml(url)).rejects.toMatchObject({ cause: failure });
            expect(fromURL).toHaveBeenCalledTimes(1);
        },
    );

    it("stops after five attempts and retains the failed URL and original error", async () => {
        const failure = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
        fromURL.mockRejectedValue(failure);
        const started = Date.now();
        // Attach the rejection handler before advancing timers.
        const result = getHtml(url).catch((error) => error);
        await jest.runAllTimersAsync();
        const error = await result;
        expect(error.message).toContain(url);
        expect(error.message).toContain("attempt 5/5");
        expect(error.cause).toBe(failure);
        expect(fromURL).toHaveBeenCalledTimes(5);
        expect(console.warn).toHaveBeenCalledTimes(4);
        expect(Date.now() - started).toBe(15000); // 1s, 2s, 4s, 8s backoff.
        expect(jest.getTimerCount()).toBe(0);
    });
});

describe("Wikipedia HTTP status handling with real Cheerio/Undici", () => {
    it("recovers from HTTP 503 and a dropped socket, and rejects HTTP 404", async () => {
        fromURL.mockImplementation(jest.requireActual<typeof cheerio>("cheerio").fromURL);
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        let requests = 0;
        let resetRequests = 0;
        const server = createServer((req, res) => {
            requests += 1;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            if (req.url === "/reset" && ++resetRequests === 1) {
                req.socket.destroy();
            } else if (req.url === "/missing") {
                res.writeHead(404).end("Missing page");
            } else if (requests === 1) {
                res.writeHead(503).end("Temporarily unavailable");
            } else {
                res.end('<div id="mw-pages">Recovered category</div>');
            }
        });
        try {
            await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
            const address = server.address();
            if (!address || typeof address === "string") throw new Error("No server address");
            const base = `http://127.0.0.1:${address.port}`;
            expect(await getHtml(base)).toContain("Recovered category");
            expect(requests).toBe(2);
            expect(await getHtml(`${base}/reset`)).toContain("Recovered category");
            expect(resetRequests).toBe(2);
            await expect(getHtml(`${base}/missing`)).rejects.toMatchObject({ cause: { statusCode: 404 } });
            expect(requests).toBe(5);
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
            warn.mockRestore();
        }
    });
});
