import {setImmediate} from "node:timers/promises";
import {FastifyInstance, FastifyReply, fastify} from "fastify";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {getEnvLogger} from "@lodestar/logger/env";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {FetchError, defer} from "@lodestar/utils";
import {EngineApiMode, ExecutionEngineHttp} from "../../../src/execution/engine/http.js";
import {getExecutionEngineHttp} from "../../../src/execution/engine/index.js";
import {ExecutionEngineState} from "../../../src/execution/engine/interface.js";
import {JsonRpcHttpClient, JsonRpcHttpClientEvent} from "../../../src/execution/engine/jsonRpcHttpClient.js";
import {JsonRpcEngineTransport} from "../../../src/execution/engine/jsonRpcTransport.js";
import {EngineRestHttpClient} from "../../../src/execution/engine/restHttpClient.js";
import {RestEngineTransport} from "../../../src/execution/engine/restTransport.js";
import {ForkchoiceUpdateResponse, PayloadStatus, PayloadStatusCode} from "../../../src/execution/engine/sszTypes.js";

const hash = `0x${"11".repeat(32)}`;
const capabilities = {
  supported_forks: ["paris", "cancun"],
  independently_versioned: {blobs: ["v1", "v2"]},
};
const validStatus = {status: PayloadStatusCode.VALID, latestValidHash: [], validationError: []};

describe("REST engine compatibility", () => {
  let server: FastifyInstance;
  let url: string;
  let controller: AbortController;
  let discovery: {status: number; body: unknown};
  let restError: {status: number; body: unknown} | undefined;
  let malformedResponse: boolean;
  let requests: string[];
  let beforePayload: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    controller = new AbortController();
    discovery = {status: 200, body: capabilities};
    restError = undefined;
    malformedResponse = false;
    beforePayload = undefined;
    requests = [];
    server = fastify({forceCloseConnections: true});
    server.addContentTypeParser("application/octet-stream", {parseAs: "buffer"}, (_, body, done) => done(null, body));
    server.get("/engine/v1/capabilities", (_, reply) => {
      requests.push("capabilities");
      return reply.code(discovery.status).send(discovery.body);
    });
    server.get("/engine/v1/identity", () => [{code: "XX", name: "Test EL", version: "1", commit: "0x12345678"}]);
    server.post("/engine/v1/payloads", async (_, reply) => {
      requests.push("REST newPayload");
      await beforePayload?.();
      return sendResponse(reply, PayloadStatus.serialize(validStatus));
    });
    server.post("/engine/v1/forkchoice", (_, reply) => {
      requests.push("REST forkchoice");
      return sendResponse(reply, ForkchoiceUpdateResponse.serialize({payloadStatus: validStatus, payloadId: []}));
    });
    server.post<{Body: {method: string}}>("/", (req) => {
      const method = req.body.method;
      if (method === "engine_getClientVersionV1") {
        return {jsonrpc: "2.0", id: 1, result: [{code: "XX", name: "Test EL", version: "1", commit: "0x12345678"}]};
      }
      requests.push(method);
      const status = {status: "VALID", latestValidHash: null, validationError: null};
      return {
        jsonrpc: "2.0",
        id: 1,
        result: method.startsWith("engine_forkchoiceUpdated") ? {payloadStatus: status, payloadId: null} : status,
      };
    });
    url = await server.listen({host: "127.0.0.1", port: 0});
  });

  afterEach(async () => {
    controller.abort();
    await server.close();
    vi.restoreAllMocks();
  });

  function sendResponse(reply: FastifyReply, body: Uint8Array): FastifyReply {
    if (restError) return reply.code(restError.status).send(restError.body);
    return reply.type("application/octet-stream").send(Buffer.from(malformedResponse ? [] : body));
  }

  function createEngine(engineApi: EngineApiMode = "auto", urls = [url]) {
    return getExecutionEngineHttp(
      {urls, engineApi, retries: 0, retryDelay: 0},
      {signal: controller.signal, logger: getEnvLogger()}
    );
  }

  it("remembers a discovery 404 for the connection", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    discovery = {status: 404, body: {}};
    const engine = createEngine();
    await engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash);
    now.mockReturnValue(200_000);
    discovery = {status: 200, body: capabilities};
    await engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash);
    expect(requests).toEqual(["capabilities", "engine_forkchoiceUpdatedV1", "engine_forkchoiceUpdatedV1"]);
  });

  it("rediscovers REST after the execution client reconnects", async () => {
    discovery = {status: 404, body: {}};
    const rpc = new JsonRpcHttpClient([url], {signal: controller.signal, retries: 0});
    const engine = new ExecutionEngineHttp(
      {
        jsonRpc: new JsonRpcEngineTransport(rpc),
        rest: new RestEngineTransport(new EngineRestHttpClient([url], {signal: controller.signal})),
      },
      {signal: controller.signal, logger: getEnvLogger()}
    );
    await engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash);
    await vi.waitFor(() => expect(engine.clientVersion?.name).toBe("Test EL"));
    const failure = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connection refused"), {code: "ECONNREFUSED"}),
    });
    rpc.emitter.emit(JsonRpcHttpClientEvent.ERROR, {error: new FetchError(url, failure)});
    expect(engine.state).toBe(ExecutionEngineState.OFFLINE);

    discovery = {status: 200, body: capabilities};
    await engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash);
    await vi.waitFor(() => expect(requests.filter((request) => request === "capabilities")).toHaveLength(2));
    await engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash);
    expect(requests.at(-1)).toBe("REST forkchoice");
  });

  it("reprobes after a temporary discovery failure without probing every call", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    discovery = {status: 503, body: {}};
    const engine = createEngine();
    await engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash);
    await engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash);
    expect(requests).toEqual(["capabilities", "engine_forkchoiceUpdatedV1", "engine_forkchoiceUpdatedV1"]);
    discovery = {status: 200, body: capabilities};
    now.mockReturnValue(112_001);
    await engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash);
    expect(requests.slice(-2)).toEqual(["capabilities", "REST forkchoice"]);
  });

  it.each([401, 403])("surfaces discovery authentication failure %s without downgrading", async (status) => {
    discovery = {status, body: {}};
    const engine = createEngine();
    await expect(engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash)).rejects.toMatchObject({status});
    await expect(engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash)).rejects.toMatchObject({status});
    expect(engine.state).toBe(ExecutionEngineState.AUTH_FAILED);
    expect(requests).toEqual(["capabilities"]);
  });

  it("preserves authentication state when newPayload returns ELERROR", async () => {
    discovery = {status: 401, body: {}};
    const engine = createEngine();
    const result = await engine.notifyNewPayload(ForkName.bellatrix, ssz.bellatrix.ExecutionPayload.defaultValue());
    expect(result.status).toBe("ELERROR");
    expect(engine.state).toBe(ExecutionEngineState.AUTH_FAILED);
    expect(requests).toEqual(["capabilities"]);
  });

  it.each([null, {supported_forks: "paris"}])("rejects malformed capabilities %j without downgrading", async (body) => {
    discovery = {status: 200, body};
    const engine = createEngine();
    await expect(engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash)).rejects.toThrow();
    expect(requests).toEqual(["capabilities"]);
  });

  it.each([400, 401, 404, 409, 503])("does not downgrade an established REST call on HTTP %s", async (status) => {
    restError = {status, body: {type: "/engine-api/errors/internal"}};
    const engine = createEngine();
    await expect(engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash)).rejects.toMatchObject({status});
    expect(requests).toEqual(["capabilities", "REST forkchoice"]);
  });

  it("does not downgrade malformed SSZ responses", async () => {
    malformedResponse = true;
    const engine = createEngine();
    await expect(engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash)).rejects.toThrow();
    expect(requests).toEqual(["capabilities", "REST forkchoice"]);
  });

  it("does not downgrade discovery errors in strict SSZ mode", async () => {
    discovery = {status: 404, body: {}};
    const engine = createEngine("ssz");
    await expect(engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash)).rejects.toMatchObject({
      status: 404,
    });
    expect(requests).toEqual(["capabilities"]);
  });

  it("does not apply the unsupported-fork workaround in strict SSZ mode", async () => {
    restError = {status: 400, body: {type: "/engine-api/errors/unsupported-fork"}};
    const engine = createEngine("ssz");
    await expect(engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash)).rejects.toMatchObject({
      status: 400,
    });
    expect(requests).toEqual(["capabilities", "REST forkchoice"]);
  });

  it("keeps multiple execution URLs on JSON-RPC in auto mode", async () => {
    const engine = createEngine("auto", [url, url]);
    await engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash);
    expect(requests).toEqual(["engine_forkchoiceUpdatedV1"]);
  });

  it("rejects multiple execution URLs in strict SSZ mode", () => {
    expect(() => createEngine("ssz", [url, url])).toThrow("ENGINE_REST_REQUIRES_SINGLE_URL");
  });

  it("keeps newPayload, its fork fallback, and the next forkchoice update in order", async () => {
    const started = defer<void>();
    const release = defer<void>();
    beforePayload = async () => {
      started.resolve();
      await release.promise;
    };
    restError = {status: 400, body: {type: "/engine-api/errors/unsupported-fork", detail: "x".repeat(600)}};
    const engine = createEngine();
    const payload = engine.notifyNewPayload(ForkName.bellatrix, ssz.bellatrix.ExecutionPayload.defaultValue());
    await started.promise;
    const forkchoice = engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash);
    await setImmediate();
    try {
      expect(requests).toEqual(["capabilities", "REST newPayload"]);
    } finally {
      release.resolve();
    }
    expect((await payload).status).toBe("VALID");
    await forkchoice;
    expect(requests).toEqual(["capabilities", "REST newPayload", "engine_newPayloadV1", "engine_forkchoiceUpdatedV1"]);
  });
});
