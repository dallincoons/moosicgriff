const globalAny = globalThis;

if (typeof globalAny.ReadableStream === "undefined") {
  try {
    const webStreams = require("stream/web");
    if (webStreams && webStreams.ReadableStream) {
      globalAny.ReadableStream = webStreams.ReadableStream;
    }
    if (webStreams && webStreams.WritableStream && typeof globalAny.WritableStream === "undefined") {
      globalAny.WritableStream = webStreams.WritableStream;
    }
    if (webStreams && webStreams.TransformStream && typeof globalAny.TransformStream === "undefined") {
      globalAny.TransformStream = webStreams.TransformStream;
    }
  } catch (e) {
  }
}

if (typeof globalAny.ReadableStream === "undefined") {
  try {
    const ponyfill = require("web-streams-polyfill/ponyfill");
    if (ponyfill && ponyfill.ReadableStream) {
      globalAny.ReadableStream = ponyfill.ReadableStream;
    }
    if (ponyfill && ponyfill.WritableStream && typeof globalAny.WritableStream === "undefined") {
      globalAny.WritableStream = ponyfill.WritableStream;
    }
    if (ponyfill && ponyfill.TransformStream && typeof globalAny.TransformStream === "undefined") {
      globalAny.TransformStream = ponyfill.TransformStream;
    }
  } catch (e) {
  }
}

if (typeof globalAny.fetch === "undefined") {
  try {
    const undici = require("undici");
    if (typeof undici.fetch === "function") {
      globalAny.fetch = undici.fetch;
    }
    if (undici.Headers && typeof globalAny.Headers === "undefined") {
      globalAny.Headers = undici.Headers;
    }
    if (undici.Request && typeof globalAny.Request === "undefined") {
      globalAny.Request = undici.Request;
    }
    if (undici.Response && typeof globalAny.Response === "undefined") {
      globalAny.Response = undici.Response;
    }
  } catch (e) {
  }
}
