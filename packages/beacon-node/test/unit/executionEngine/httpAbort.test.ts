import {FastifyInstance, FastifyReply, fastify} from "fastify";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {Logger} from "@lodestar/logger";
import {ForkName} from "@lodestar/params";
import {ErrorAborted, defer, fromHex} from "@lodestar/utils";
import {EngineApiMode} from "../../../src/execution/engine/http.js";
import {ForkchoiceUpdateResponse, PayloadStatusCode} from "../../../src/execution/engine/sszTypes.js";
import {RpcPayload} from "../../../src/execution/engine/utils.js";
import {IExecutionEngine, PayloadAttributes, initializeExecutionEngine} from "../../../src/execution/index.js";

describe.each<EngineApiMode>(["json-rpc", "ssz"])("ExecutionEngine / http / request signal / %s", (engineApi) => {
  const hashHex = "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174";
  const hash = fromHex(hashHex);
  const payloadAttributes: PayloadAttributes = {
    timestamp: 1647036763,
    prevRandao: hash,
    suggestedFeeRecipient: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
    withdrawals: [],
    parentBeaconBlockRoot: hash,
  };
  // Longer than the test timeout, a retry of an aborted request fails the test
  const retryDelay = 60_000;

  let server: FastifyInstance;
  let controller: AbortController;
  let executionEngine: IExecutionEngine;
  /** Number of forkchoice update and payload requests received by the execution client */
  let requests: number;
  /** Respond to the next request with a server error */
  let failNext: boolean;
  let received: ReturnType<typeof defer<void>>;
  let release: ReturnType<typeof defer<void>>;

  /** Holds a request until released, returns true if it was answered with a server error */
  async function hold(reply: FastifyReply): Promise<boolean> {
    requests++;
    received.resolve();
    if (failNext) {
      failNext = false;
      await reply.code(500).send();
      return true;
    }
    await release.promise;
    return false;
  }

  beforeEach(async () => {
    requests = 0;
    failNext = false;
    received = defer<void>();
    release = defer<void>();
    controller = new AbortController();
    server = fastify({logger: false, forceCloseConnections: true});
    server.addContentTypeParser("application/octet-stream", {parseAs: "buffer"}, (_req, body, done) => {
      done(null, body);
    });

    server.post("/", async (req, reply) => {
      const {method} = req.body as RpcPayload;
      if (method === "engine_getClientVersionV1") {
        return [];
      }
      if (await hold(reply)) return reply;
      return {
        jsonrpc: "2.0",
        id: 1,
        result: {payloadStatus: {status: "VALID", latestValidHash: null, validationError: null}, payloadId: null},
      };
    });
    server.get("/engine/v1/capabilities", async () => ({
      supported_forks: ["paris", "shanghai", "cancun"],
      fork_scoped_endpoints: ["payloads", "forkchoice", "bodies"],
      independently_versioned: {blobs: ["v1"]},
      unscoped_endpoints: ["capabilities", "identity"],
      limits: {"bodies.max_count": 32, "blobs.max_versioned_hashes": 128, "payload.max_bytes": 67108864},
    }));
    server.get("/engine/v1/identity", async () => []);
    server.post("/engine/v1/forkchoice", async (_req, reply) => {
      if (await hold(reply)) return reply;
      const body = ForkchoiceUpdateResponse.serialize({
        payloadStatus: {status: PayloadStatusCode.VALID, latestValidHash: [hash], validationError: []},
        payloadId: [],
      });
      return reply.type("application/octet-stream").send(Buffer.from(body));
    });
    server.get("/engine/v1/payloads/:payloadId", async (_req, reply) => {
      await hold(reply);
      return reply;
    });

    executionEngine = initializeExecutionEngine(
      {mode: "http", urls: [await server.listen({port: 0})], engineApi, retries: 2, retryDelay},
      {signal: controller.signal, logger: console as unknown as Logger}
    );
  });

  afterEach(async () => {
    release.resolve();
    controller.abort();
    await server.close();
  });

  it("aborts an in-flight payload request", async () => {
    const request = new AbortController();
    const pending = expect(
      executionEngine.getPayload(ForkName.deneb, "0x0000000000000001", request.signal)
    ).rejects.toThrow(ErrorAborted);
    await received.promise;
    request.abort();

    await pending;
  });

  it("does not retry an aborted forkchoice update", async () => {
    const request = new AbortController();
    const pending = expect(
      executionEngine.notifyForkchoiceUpdate(
        ForkName.deneb,
        hashHex,
        hashHex,
        hashHex,
        payloadAttributes,
        request.signal
      )
    ).rejects.toThrow(ErrorAborted);
    await received.promise;
    request.abort();

    await pending;
    expect(requests).toBe(1);
  });

  it("aborts a forkchoice update that is waiting to be retried", async () => {
    failNext = true;
    const request = new AbortController();
    const pending = expect(
      executionEngine.notifyForkchoiceUpdate(
        ForkName.deneb,
        hashHex,
        hashHex,
        hashHex,
        payloadAttributes,
        request.signal
      )
    ).rejects.toThrow(ErrorAborted);
    await received.promise;
    // Let the failed attempt be handled, the request is now in the delay before its retry
    await new Promise((resolve) => setTimeout(resolve, 200));
    request.abort();

    await pending;
    expect(requests).toBe(1);
  });

  it("does not send a queued forkchoice update that was aborted", async () => {
    const request = new AbortController();
    const inFlight = executionEngine.notifyForkchoiceUpdate(ForkName.deneb, hashHex, hashHex, hashHex);
    const queued = expect(
      executionEngine.notifyForkchoiceUpdate(
        ForkName.deneb,
        hashHex,
        hashHex,
        hashHex,
        payloadAttributes,
        request.signal
      )
    ).rejects.toThrow(ErrorAborted);
    await received.promise;
    request.abort();
    release.resolve();

    await inFlight;
    await queued;
    expect(requests).toBe(1);
  });
});
