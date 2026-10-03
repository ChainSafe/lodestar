import {FastifyInstance, fastify} from "fastify";
import {afterEach, describe, expect, it} from "vitest";
import {ErrorAborted, TimeoutError, defer} from "@lodestar/utils";
import {EngineRestError, EngineRestHttpClient} from "../../../src/execution/engine/restHttpClient.js";

describe("EngineRestHttpClient", () => {
  const servers: FastifyInstance[] = [];

  async function startServer(register: (server: FastifyInstance) => void): Promise<string> {
    const server = fastify({forceCloseConnections: true});
    servers.push(server);
    register(server);
    return server.listen({host: "127.0.0.1", port: 0});
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  const request = {method: "GET", path: "/identity", responseType: "json"} as const;

  it("preserves the problem type when truncating a long diagnostic", async () => {
    const type = "/engine-api/errors/unsupported-fork";
    const url = await startServer((server) => {
      server.get("/engine/v1/identity", (_, reply) => reply.code(400).send({type, detail: "x".repeat(600)}));
    });
    await expect(new EngineRestHttpClient([url]).requestWithRetries(request)).rejects.toMatchObject({
      status: 400,
      type,
      detail: "x".repeat(500),
    });
  });

  it.each(["not found", '{"code":-32000,"message":"boom"}', "null"])(
    "retains the diagnostic for a non-problem body: %s",
    async (body) => {
      const url = await startServer((server) => {
        server.get("/engine/v1/identity", (_, reply) => reply.code(404).type("text/plain").send(body));
      });
      await expect(new EngineRestHttpClient([url]).requestWithRetries(request)).rejects.toMatchObject({
        status: 404,
        type: null,
        detail: body,
      });
    }
  );

  it("does not send a request after shutdown", async () => {
    let requests = 0;
    const url = await startServer((server) => {
      server.get("/engine/v1/identity", () => {
        requests++;
        return [];
      });
    });
    const controller = new AbortController();
    controller.abort();
    const client = new EngineRestHttpClient([url], {signal: controller.signal});
    await expect(client.requestWithRetries(request)).rejects.toBeInstanceOf(ErrorAborted);
    expect(requests).toBe(0);
  });

  it("aborts an in-flight request on shutdown", async () => {
    const started = defer<void>();
    const url = await startServer((server) => {
      server.get("/engine/v1/identity", (_, reply) => {
        reply.hijack();
        started.resolve();
      });
    });
    const controller = new AbortController();
    const client = new EngineRestHttpClient([url], {signal: controller.signal, timeout: 60_000});
    const pending = expect(client.requestWithRetries(request)).rejects.toBeInstanceOf(ErrorAborted);
    await started.promise;
    controller.abort();
    await pending;
  });

  it("times out while reading a stalled response body", async () => {
    const url = await startServer((server) => {
      server.get("/engine/v1/identity", (_, reply) => {
        reply.hijack();
        reply.raw.writeHead(200, {"content-type": "application/json"});
        reply.raw.write("[");
      });
    });
    await expect(new EngineRestHttpClient([url], {timeout: 100}).requestWithRetries(request)).rejects.toBeInstanceOf(
      TimeoutError
    );
  });

  it("retries server errors using the configured policy", async () => {
    let requests = 0;
    const url = await startServer((server) => {
      server.get("/engine/v1/identity", (_, reply) => {
        requests++;
        return requests < 3 ? reply.code(503).send({}) : [];
      });
    });
    const client = new EngineRestHttpClient([url], {retries: 2, retryDelay: 0});
    await expect(client.requestWithRetries(request)).resolves.toMatchObject({status: 200});
    expect(requests).toBe(3);
  });

  it("honors a per-request retry override", async () => {
    let requests = 0;
    const url = await startServer((server) => {
      server.get("/engine/v1/identity", (_, reply) => {
        requests++;
        return reply.code(503).send({});
      });
    });
    const client = new EngineRestHttpClient([url], {retries: 2, retryDelay: 0});
    await expect(client.requestWithRetries(request, {retries: 0})).rejects.toBeInstanceOf(EngineRestError);
    expect(requests).toBe(1);
  });

  it("does not retry or try another URL on a semantic error", async () => {
    let requests = 0;
    const url = await startServer((server) => {
      server.get("/engine/v1/identity", (_, reply) => {
        requests++;
        return reply.code(409).send({type: "/engine-api/errors/invalid-forkchoice"});
      });
    });
    const client = new EngineRestHttpClient([url, url], {retries: 2, retryDelay: 0});
    await expect(client.requestWithRetries(request)).rejects.toMatchObject({status: 409});
    expect(requests).toBe(1);
  });

  it("does not retry malformed response framing", async () => {
    let requests = 0;
    const url = await startServer((server) => {
      server.get("/engine/v1/identity", (_, reply) => {
        requests++;
        return reply.type("text/html").send("unexpected response");
      });
    });
    const client = new EngineRestHttpClient([url], {retries: 2, retryDelay: 0});
    await expect(client.requestWithRetries(request)).rejects.toMatchObject({
      type: {code: "ENGINE_REST_INVALID_RESPONSE"},
    });
    expect(requests).toBe(1);
  });
});
