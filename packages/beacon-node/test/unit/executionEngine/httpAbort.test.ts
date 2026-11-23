import {FastifyInstance, fastify} from "fastify";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {Logger} from "@lodestar/logger";
import {ForkName} from "@lodestar/params";
import {ErrorAborted, defer} from "@lodestar/utils";
import {RpcPayload} from "../../../src/execution/engine/utils.js";
import {IExecutionEngine, PayloadAttributes, initializeExecutionEngine} from "../../../src/execution/index.js";

describe("ExecutionEngine / http / request signal", () => {
  const hash = "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174";
  const payloadAttributes: PayloadAttributes = {
    timestamp: 1647036763,
    prevRandao: Buffer.alloc(32),
    suggestedFeeRecipient: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
  };
  const forkchoiceUpdatedResponse = {
    jsonrpc: "2.0",
    id: 1,
    result: {payloadStatus: {status: "VALID", latestValidHash: null, validationError: null}, payloadId: "0x"},
  };

  // Longer than the test timeout, a retry of an aborted request fails the test
  const retryDelay = 60_000;

  let server: FastifyInstance;
  let controller: AbortController;
  let executionEngine: IExecutionEngine;
  /** Methods of the requests received by the execution client */
  let requests: string[];
  let received: ReturnType<typeof defer<void>>;
  let release: ReturnType<typeof defer<void>>;

  beforeEach(async () => {
    requests = [];
    received = defer<void>();
    release = defer<void>();
    controller = new AbortController();
    server = fastify({logger: false, forceCloseConnections: true});

    server.post("/", async (req) => {
      const {method} = req.body as RpcPayload;
      if (method === "engine_getClientVersionV1") {
        return [];
      }
      requests.push(method);
      received.resolve();
      await release.promise;
      return forkchoiceUpdatedResponse;
    });

    executionEngine = initializeExecutionEngine(
      {mode: "http", urls: [await server.listen({port: 0})], engineApi: "json-rpc", retries: 2, retryDelay},
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
    const pending = expect(executionEngine.getPayload(ForkName.bellatrix, "0x00", request.signal)).rejects.toThrow(
      ErrorAborted
    );
    await received.promise;
    request.abort();

    await pending;
  });

  it("does not retry an aborted forkchoice update", async () => {
    const request = new AbortController();
    const pending = expect(
      executionEngine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash, payloadAttributes, request.signal)
    ).rejects.toThrow(ErrorAborted);
    await received.promise;
    request.abort();

    await pending;
    expect(requests).toEqual(["engine_forkchoiceUpdatedV1"]);
  });

  it("does not send a queued forkchoice update that was aborted", async () => {
    const request = new AbortController();
    const inFlight = executionEngine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash);
    const queued = expect(
      executionEngine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash, payloadAttributes, request.signal)
    ).rejects.toThrow(ErrorAborted);
    await received.promise;
    request.abort();
    release.resolve();

    await inFlight;
    await queued;
    expect(requests).toEqual(["engine_forkchoiceUpdatedV1"]);
  });
});
