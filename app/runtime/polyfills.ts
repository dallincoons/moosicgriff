export function applyRuntimePolyfills(): void {
    const globalAny = globalThis as any;

    if (typeof globalAny.ReadableStream === "undefined") {
        try {
            // Node 16 compatibility for deps expecting Web Streams globals.
            const webStreams = require("stream/web");
            if (webStreams?.ReadableStream) {
                globalAny.ReadableStream = webStreams.ReadableStream;
            }
            if (webStreams?.WritableStream && typeof globalAny.WritableStream === "undefined") {
                globalAny.WritableStream = webStreams.WritableStream;
            }
            if (webStreams?.TransformStream && typeof globalAny.TransformStream === "undefined") {
                globalAny.TransformStream = webStreams.TransformStream;
            }
        } catch (e) {
            // Best-effort polyfill; if unavailable, existing runtime error remains explicit.
        }
    }

    if (typeof globalAny.fetch === "undefined") {
        try {
            // Node 16 compatibility for runtime code using global fetch.
            const undici = require("undici");
            if (typeof undici?.fetch === "function") {
                globalAny.fetch = undici.fetch;
            }
            if (undici?.Headers && typeof globalAny.Headers === "undefined") {
                globalAny.Headers = undici.Headers;
            }
            if (undici?.Request && typeof globalAny.Request === "undefined") {
                globalAny.Request = undici.Request;
            }
            if (undici?.Response && typeof globalAny.Response === "undefined") {
                globalAny.Response = undici.Response;
            }
        } catch (e) {
            // Best-effort polyfill; if unavailable, existing runtime error remains explicit.
        }
    }
}
