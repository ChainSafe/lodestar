import {FastifyInstance, fastify} from "fastify";
import {afterEach, describe, expect, it} from "vitest";
import {HttpRpcError} from "../../../src/execution/engine/jsonRpcHttpClient.js";
import {decodeJwtToken} from "../../../src/execution/engine/jwt.js";
import {SszRestClient, SszRestError} from "../../../src/execution/engine/sszRestClient.js";

const JWT_SECRET_HEX = "aa".repeat(32);

type Seen = {method: string; url: string; headers: Record<string, string | string[] | undefined>; body?: Buffer};

// Note: routes must be registered via `registerRoutes` before `listen()` is called —
// this fastify version rejects adding routes to an already-listening instance.
async function startServer(
  afterCallbacks: (() => Promise<void>)[],
  registerRoutes: (server: FastifyInstance) => void
): Promise<{url: string; seen: Seen[]}> {
  // forceCloseConnections lets afterEach's server.close() tear down promptly even when
  // a test deliberately leaves a connection open (hijacked, never-ending response body).
  const server = fastify({logger: false, forceCloseConnections: true});
  const seen: Seen[] = [];
  server.addContentTypeParser("application/octet-stream", {parseAs: "buffer"}, (_req, body, done) => done(null, body));
  server.addHook("onRequest", async (req) => {
    seen.push({method: req.method, url: req.url, headers: req.headers});
  });
  registerRoutes(server);
  const url = await server.listen({host: "127.0.0.1", port: 0});
  afterCallbacks.push(async () => server.close());
  return {url, seen};
}

describe("SszRestClient", () => {
  const afterCallbacks: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (afterCallbacks.length) await afterCallbacks.pop()?.();
  });

  it("sends SSZ headers, fork header, client version and a JWT without clv", async () => {
    const {url, seen} = await startServer(afterCallbacks, (server) => {
      server.post("/engine/v1/payloads", async (_req, reply) => {
        reply.header("Content-Type", "application/octet-stream").send(Buffer.from([1, 2, 3]));
      });
    });
    const client = new SszRestClient({
      baseUrl: url,
      clientVersionHeader: "LS/v1.2.3",
      jwtSecretHex: JWT_SECRET_HEX,
      jwtId: "id1",
    });

    const out = await client.requestSsz("POST", "/engine/v1/payloads", {fork: "cancun", body: new Uint8Array([9])});

    expect(out).toEqual(new Uint8Array([1, 2, 3]));
    const h = seen[0].headers;
    expect(h["content-type"]).toBe("application/octet-stream");
    expect(h.accept).toBe("application/octet-stream");
    expect(h["eth-execution-version"]).toBe("cancun");
    expect(h["x-engine-client-version"]).toBe("LS/v1.2.3");
    const claim = decodeJwtToken(
      (h.authorization as string).replace("Bearer ", ""),
      Buffer.from(JWT_SECRET_HEX, "hex")
    );
    expect(claim.id).toBe("id1");
    expect(typeof claim.iat).toBe("number");
    expect(claim).not.toHaveProperty("clv");
  });

  it("omits the fork header and Content-Type on unscoped GET; JSON endpoints accept application/json", async () => {
    const {url, seen} = await startServer(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async () => ({supported_forks: ["cancun"]}));
    });
    const client = new SszRestClient({baseUrl: url, clientVersionHeader: "LS/v0"});

    const json = await client.requestJson("/engine/v1/capabilities");

    expect(json).toEqual({supported_forks: ["cancun"]});
    expect(seen[0].headers["eth-execution-version"]).toBeUndefined();
    expect(seen[0].headers["content-type"]).toBeUndefined();
    expect(seen[0].headers.accept).toBe("application/json");
    expect(seen[0].headers.authorization).toBeUndefined();
  });

  it("returns null on 204", async () => {
    const {url} = await startServer(afterCallbacks, (server) => {
      server.post("/engine/v1/blobs/v2", async (_req, reply) => reply.code(204).send());
    });
    const client = new SszRestClient({baseUrl: url, clientVersionHeader: "LS/v0"});
    expect(await client.requestSsz("POST", "/engine/v1/blobs/v2", {body: new Uint8Array()})).toBeNull();
  });

  it("parses application/problem+json into SszRestError (an HttpRpcError)", async () => {
    const {url} = await startServer(afterCallbacks, (server) => {
      server.post("/engine/v1/forkchoice", async (_req, reply) =>
        reply
          .code(409)
          .header("Content-Type", "application/problem+json")
          .send({type: "/engine-api/errors/invalid-forkchoice", detail: "finalized not ancestor"})
      );
    });
    const client = new SszRestClient({baseUrl: url, clientVersionHeader: "LS/v0"});

    let err: unknown;
    try {
      await client.requestSsz("POST", "/engine/v1/forkchoice", {fork: "cancun", body: new Uint8Array()});
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(SszRestError);
    expect(err).toBeInstanceOf(HttpRpcError);
    const sszErr = err as SszRestError;
    expect(sszErr.status).toBe(409);
    expect(sszErr.type).toBe("/engine-api/errors/invalid-forkchoice");
    expect(sszErr.detail).toBe("finalized not ancestor");
    expect(sszErr.message).toContain("invalid-forkchoice");
  });

  it("tolerates non-JSON error bodies (legacy 404 page)", async () => {
    const {url} = await startServer(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async (_req, reply) =>
        reply.code(404).type("text/plain").send("not found")
      );
    });
    const client = new SszRestClient({baseUrl: url, clientVersionHeader: "LS/v0"});

    let err: unknown;
    try {
      await client.requestJson("/engine/v1/capabilities");
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(SszRestError);
    const sszErr = err as SszRestError;
    expect(sszErr.status).toBe(404);
    expect(sszErr.type).toBeUndefined();
    expect(sszErr.detail).toBe("not found");
  });

  it("propagates timeout as a fetch error, not an SszRestError", async () => {
    const {url} = await startServer(afterCallbacks, (server) => {
      server.get("/engine/v1/identity", async () => new Promise(() => undefined));
    });
    const client = new SszRestClient({baseUrl: url, clientVersionHeader: "LS/v0", timeout: 50});

    let err: unknown;
    try {
      await client.requestJson("/engine/v1/identity");
    } catch (e) {
      err = e;
    }

    expect(err).not.toBeInstanceOf(SszRestError);
    expect((err as {code: string}).code).toBe("ERR_ABORTED");
  });

  it("falls back to the raw body as detail for non-RFC-7807 JSON error bodies", async () => {
    const rawBody = '{"code":-32000,"message":"boom"}';
    const {url} = await startServer(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async (_req, reply) =>
        reply.code(500).header("Content-Type", "application/json").send(rawBody)
      );
    });
    const client = new SszRestClient({baseUrl: url, clientVersionHeader: "LS/v0"});

    let err: unknown;
    try {
      await client.requestJson("/engine/v1/capabilities");
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(SszRestError);
    const sszErr = err as SszRestError;
    expect(sszErr.status).toBe(500);
    expect(sszErr.type).toBeUndefined();
    expect(sszErr.detail).toBe(rawBody);
  });

  it("aborts a stalled 200 body read once the timeout elapses", async () => {
    const {url} = await startServer(afterCallbacks, (server) => {
      server.get("/engine/v1/payloads/1", (_req, reply) => {
        reply.hijack();
        reply.raw.writeHead(200, {"content-type": "application/octet-stream"});
        reply.raw.write(Buffer.from([1]));
        // Deliberately never end() the response — the client must time out reading it.
      });
    });
    const client = new SszRestClient({baseUrl: url, clientVersionHeader: "LS/v0", timeout: 50});

    let err: unknown;
    try {
      await client.requestSsz("GET", "/engine/v1/payloads/1");
    } catch (e) {
      err = e;
    }

    expect(err).not.toBeInstanceOf(SszRestError);
    expect((err as {code: string}).code).toBe("ERR_ABORTED");
  });
});
