import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createRequire } from "node:module";
import {
  assertUrlIsSafeToFetch,
  guardedFetch,
  guardedFetchText,
  isGuardedFetchError,
  isSafeIpAddress,
  readBodyAsText,
} from "guarded-fetch";
import { ProxyAgent } from "undici";

const require = createRequire(import.meta.url);
const { createServer: createSocksServer } = require("@pondwader/socks5-server");

const results = [];
let failures = 0;

const serializeError = (error) => ({
  name: error?.name ?? "Error",
  message: error instanceof Error ? error.message : String(error),
  ...(isGuardedFetchError(error) ? { code: error.code } : {}),
});

const record = (name, status, detail = {}) => {
  results.push({ name, status, ...detail });
  const prefix = status === "pass" ? "PASS" : status === "risk" ? "RISK" : "FAIL";
  console.log(prefix + " " + name, detail);
};

const run = async (name, fn) => {
  try {
    const detail = (await fn()) ?? {};
    record(name, "pass", detail);
  } catch (error) {
    failures += 1;
    record(name, "fail", { error: serializeError(error) });
  }
};

const expectGuardedCode = async (operation, expectedCode) => {
  try {
    await operation();
  } catch (error) {
    assert.equal(isGuardedFetchError(error), true, "expected GuardedFetchError");
    assert.equal(error.code, expectedCode);
    return error;
  }
  assert.fail("expected guarded-fetch error code " + expectedCode);
};

const listen = (server) =>
  new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      assert(address && typeof address !== "string");
      resolve(address.port);
    });
  });

const closeServer = (server) =>
  new Promise((resolve) => {
    server.close(() => resolve());
  });

await run("direct public HTTPS fetch", async () => {
  const response = await guardedFetch("https://example.com/", {
    timeoutMs: 15_000,
  });
  assert.equal(response.status, 200);
  const body = await readBodyAsText(response, { maxResponseBytes: 256 * 1024 });
  assert.match(body, /Example Domain/i);
  return { status: response.status, finalUrl: response.url };
});

await run("loopback is blocked", async () => {
  const error = await expectGuardedCode(
    () => assertUrlIsSafeToFetch("http://127.0.0.1:8080/"),
    "hostname_unsafe",
  );
  return { code: error.code };
});

await run("cloud metadata address is blocked", async () => {
  const error = await expectGuardedCode(
    () => assertUrlIsSafeToFetch("http://169.254.169.254/latest/meta-data/"),
    "hostname_unsafe",
  );
  return { code: error.code };
});

await run("non-HTTP protocol is blocked", async () => {
  const error = await expectGuardedCode(
    () => assertUrlIsSafeToFetch("file:///etc/passwd"),
    "protocol_not_allowed",
  );
  return { code: error.code };
});

await run("fake-IP benchmark range is classified unsafe", async () => {
  assert.equal(isSafeIpAddress("198.18.0.1"), false);
  assert.equal(isSafeIpAddress("198.19.255.254"), false);
  return {
    addresses: ["198.18.0.1", "198.19.255.254"],
    implication: "Clash-style fake-IP DNS answers in 198.18.0.0/15 are rejected.",
  };
});

await run("unsafe redirect is revalidated", async () => {
  const fakeFetch = async () =>
    new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    });
  const error = await expectGuardedCode(
    () =>
      guardedFetch("https://example.com/start", {
        fetch: fakeFetch,
        timeoutMs: 2_000,
      }),
    "redirect_to_unsafe_host",
  );
  return { code: error.code };
});

await run("response body limit is enforced", async () => {
  const fakeFetch = async () => new Response("x".repeat(4096), { status: 200 });
  const error = await expectGuardedCode(
    () =>
      guardedFetchText("https://example.com/large", {
        fetch: fakeFetch,
        maxResponseBytes: 1024,
        timeoutMs: 2_000,
      }),
    "response_too_large",
  );
  return { code: error.code };
});

await run("internal timeout is structured", async () => {
  const fakeSlowFetch = async (_url, init) =>
    new Promise((_, reject) => {
      const signal = init?.signal;
      const rejectAbort = () =>
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      if (signal?.aborted) return rejectAbort();
      signal?.addEventListener("abort", rejectAbort, { once: true });
    });
  const error = await expectGuardedCode(
    () =>
      guardedFetch("https://example.com/slow", {
        fetch: fakeSlowFetch,
        timeoutMs: 50,
      }),
    "timeout",
  );
  return { code: error.code };
});

await run("external cancellation reaches transport", async () => {
  const controller = new AbortController();
  const fakeSlowFetch = async (_url, init) =>
    new Promise((_, reject) => {
      const signal = init?.signal;
      const rejectAbort = () => reject(new DOMException("Aborted", "AbortError"));
      if (signal?.aborted) return rejectAbort();
      signal?.addEventListener("abort", rejectAbort, { once: true });
    });

  const timer = setTimeout(() => {
    controller.abort(new DOMException("User cancelled", "AbortError"));
  }, 50);

  try {
    const error = await expectGuardedCode(
      () =>
        guardedFetch("https://example.com/cancel", {
          fetch: fakeSlowFetch,
          signal: controller.signal,
          timeoutMs: 2_000,
        }),
      "network_error",
    );
    assert.equal(controller.signal.aborted, true);
    return {
      code: error.code,
      implication:
        "External cancel propagates, but guarded-fetch reports network_error; Mira must map caller-aborted invocations to cancelled.",
    };
  } finally {
    clearTimeout(timer);
  }
});

await run("SOCKS custom dispatcher compatibility and pinning gap", async () => {
  const secret = "MIRA_LOCAL_SECRET_SHOULD_NOT_BE_REACHABLE";
  const targetServer = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(secret);
  });
  const targetPort = await listen(targetServer);

  const socksServer = createSocksServer();
  socksServer.setConnectionHandler((connection, sendStatus) => {
    if (connection.command !== "connect") {
      sendStatus("COMMAND_NOT_SUPPORTED");
      return;
    }

    connection.socket.on("error", () => {});
    const upstream = net.createConnection({
      host: "127.0.0.1",
      port: targetPort,
    });
    upstream.setNoDelay();

    let opened = false;
    upstream.on("error", () => {
      if (!opened) sendStatus("GENERAL_FAILURE");
    });
    upstream.on("connect", () => {
      opened = true;
      sendStatus("REQUEST_GRANTED");
      connection.socket.pipe(upstream).pipe(connection.socket);
    });
    connection.socket.on("close", () => upstream.destroy());
  });
  const socksPort = await listen(socksServer);

  const dispatcher = new ProxyAgent("socks5://127.0.0.1:" + socksPort);

  try {
    const response = await guardedFetch(
      "http://example.com:" + targetPort + "/secret",
      {
        dispatcher,
        timeoutMs: 5_000,
      },
    );
    const body = await readBodyAsText(response, { maxResponseBytes: 16 * 1024 });
    assert.equal(body, secret);

    record("SOCKS custom dispatcher removes connect-time IP pinning", "risk", {
      proxyUrl: "socks5://127.0.0.1:<ephemeral>",
      demonstrated:
        "A public hostname passed preflight but the proxy resolved/routed it to loopback and guarded-fetch accepted the response.",
      implication:
        "Do not adopt guarded-fetch + ordinary SOCKS Dispatcher as Mira's production safe-fetch path without a transport that pins the validated destination through the proxy.",
    });

    return {
      proxyConnectivity: "works",
      bodyReachedLocalTarget: true,
    };
  } finally {
    await dispatcher.close();
    await closeServer(socksServer);
    await closeServer(targetServer);
  }
});

const summary = {
  platform: process.platform,
  node: process.version,
  guardedFetchCandidate: "guarded-fetch@0.1.5",
  undici: "7.30.0",
  failures,
  results,
};

const { writeFile } = await import("node:fs/promises");
await writeFile(
  "web-fetch-transport-result.json",
  JSON.stringify(summary, null, 2) + "\n",
  "utf8",
);

console.log("\nPOC SUMMARY");
console.log(JSON.stringify(summary, null, 2));

if (failures > 0) {
  process.exitCode = 1;
}
