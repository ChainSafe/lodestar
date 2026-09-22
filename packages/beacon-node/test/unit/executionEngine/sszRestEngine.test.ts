import {FastifyInstance, fastify} from "fastify";
import {afterEach, describe, expect, it, vi} from "vitest";
import {Logger} from "@lodestar/logger";
import {ForkName} from "@lodestar/params";
import {
  JsonRpcHttpClientEvent,
  JsonRpcHttpClientEventEmitter,
} from "../../../src/execution/engine/jsonRpcHttpClient.js";
import {SszRestClient} from "../../../src/execution/engine/sszRestClient.js";
import {SszRestEngine} from "../../../src/execution/engine/sszRestEngine.js";

// biome-ignore lint/suspicious/noExportsInTest: reused by Tasks 10-11's test files
export type FakeEl = {server: FastifyInstance; url: string};

// fastify 5 rejects routes registered after `listen()`, so `setup` must register every
// route the test needs before the server starts listening.
// biome-ignore lint/suspicious/noExportsInTest: reused by Tasks 10-11's test files
export async function startFakeEl(
  afterCallbacks: (() => Promise<void>)[],
  setup: (server: FastifyInstance) => void
): Promise<FakeEl> {
  const server = fastify({logger: false});
  server.addContentTypeParser("application/octet-stream", {parseAs: "buffer"}, (_req, body, done) => done(null, body));
  setup(server);
  const url = await server.listen({host: "127.0.0.1", port: 0});
  afterCallbacks.push(async () => server.close());
  return {server, url};
}

// biome-ignore lint/suspicious/noExportsInTest: reused by Tasks 10-11's test files
export function makeLogger(): Logger & {calls: {level: string; msg: string}[]} {
  const calls: {level: string; msg: string}[] = [];
  const mk = (level: string) => (msg: string) => calls.push({level, msg});
  return {
    calls,
    debug: mk("debug"),
    info: mk("info"),
    warn: mk("warn"),
    error: mk("error"),
    verbose: mk("verbose"),
  } as never;
}

// biome-ignore lint/suspicious/noExportsInTest: reused by Tasks 10-11's test files
export function makeEngine(url: string): {
  engine: SszRestEngine;
  logger: ReturnType<typeof makeLogger>;
  emitter: JsonRpcHttpClientEventEmitter;
} {
  const logger = makeLogger();
  const emitter = new JsonRpcHttpClientEventEmitter();
  const client = new SszRestClient({baseUrl: url, clientVersionHeader: "LS/vtest", timeout: 500});
  return {engine: new SszRestEngine(client, {logger, emitter}), logger, emitter};
}

describe("SszRestEngine / negotiation", () => {
  const afterCallbacks: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (afterCallbacks.length) await afterCallbacks.pop()?.();
  });

  it("probes /engine/v1/capabilities once and gates by supported_forks", async () => {
    let probes = 0;
    const {url} = await startFakeEl(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async () => {
        probes++;
        return {
          supported_forks: ["cancun", "prague"],
          independently_versioned: {blobs: ["v1"]},
          limits: {"bodies.max_count": 16},
        };
      });
    });
    const {engine} = makeEngine(url);

    expect(await engine.isAvailable()).toBe(true);
    expect(await engine.supportsFork(ForkName.deneb)).toBe(true);
    expect(await engine.supportsFork(ForkName.electra)).toBe(true);
    expect(await engine.supportsFork(ForkName.fulu)).toBe(false);
    expect(await engine.supportsFork(ForkName.bellatrix)).toBe(false);
    expect(await engine.supportsBlobs(1)).toBe(true);
    expect(await engine.supportsBlobs(2)).toBe(false);
    expect((await engine.limits()).bodiesMaxCount).toBe(16);
    expect(probes).toBe(1);
  });

  it("disables REST for the lifetime on 404 and logs once at info", async () => {
    const {url} = await startFakeEl(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async (_req, reply) => reply.code(404).send("legacy"));
    });
    const {engine, logger} = makeEngine(url);

    expect(await engine.isAvailable()).toBe(false);
    expect(await engine.supportsFork(ForkName.deneb)).toBe(false);
    expect(await engine.supportsBlobs(1)).toBe(false);
    expect((await engine.limits()).bodiesMaxCount).toBe(32);
    expect(logger.calls.filter((c) => c.level === "info" && /not available/.test(c.msg)).length).toBe(1);
  });

  it("disables REST on connection failure and on a malformed capabilities body", async () => {
    const {engine: down} = makeEngine("http://127.0.0.1:1");
    expect(await down.isAvailable()).toBe(false);

    const {url} = await startFakeEl(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async () => ({hello: "world"}));
    });
    const {engine: malformed} = makeEngine(url);
    expect(await malformed.isAvailable()).toBe(false);
  });

  it("identity returns ClientVersion[] and emits RESPONSE", async () => {
    const {url} = await startFakeEl(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async () => ({supported_forks: []}));
      server.get("/engine/v1/identity", async () => [{code: "GE", name: "geth", version: "1", commit: "0x01020304"}]);
    });
    const {engine, emitter} = makeEngine(url);
    const onResponse = vi.fn();
    emitter.on(JsonRpcHttpClientEvent.RESPONSE, onResponse);

    expect(await engine.identity()).toEqual([{code: "GE", name: "geth", version: "1", commit: "0x01020304"}]);
    expect(onResponse).toHaveBeenCalledTimes(1);
  });

  it("identity rejects without an HTTP request when REST is unavailable", async () => {
    let identityRequests = 0;
    const {url} = await startFakeEl(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async (_req, reply) => reply.code(404).send("legacy"));
      server.get("/engine/v1/identity", async () => {
        identityRequests++;
        return [];
      });
    });
    const {engine} = makeEngine(url);

    await expect(engine.identity()).rejects.toThrow(/not available/);
    expect(identityRequests).toBe(0);
  });

  it("emits ERROR and rethrows on a failed request", async () => {
    const {url} = await startFakeEl(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async () => ({supported_forks: []}));
      server.get("/engine/v1/identity", async (_req, reply) =>
        reply.code(500).send({type: "/engine-api/errors/internal"})
      );
    });
    const {engine, emitter} = makeEngine(url);
    const onError = vi.fn();
    emitter.on(JsonRpcHttpClientEvent.ERROR, onError);

    await expect(engine.identity()).rejects.toThrow(/internal/);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
