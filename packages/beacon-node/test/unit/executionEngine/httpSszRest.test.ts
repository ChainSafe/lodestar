import {FastifyReply, FastifyRequest, fastify} from "fastify";
import {afterEach, describe, expect, it} from "vitest";
import {ByteListType, ByteVectorType, ContainerType, ListCompositeType, UintNumberType} from "@chainsafe/ssz";
import {Logger} from "@lodestar/logger";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defaultExecutionEngineHttpOpts} from "../../../src/execution/engine/http.js";
import {ExecutionEngineState, ExecutionPayloadStatus} from "../../../src/execution/engine/interface.js";
import {SszRestError} from "../../../src/execution/engine/sszRestClient.js";
import {parseExecutionPayload} from "../../../src/execution/engine/types.js";
import {RpcPayload} from "../../../src/execution/engine/utils.js";
import {IExecutionEngine, initializeExecutionEngine} from "../../../src/execution/index.js";

// --- spec oracle containers (refactor-ssz.md) ------------------------------------
const U8 = new UintNumberType(1);
const R32 = new ByteVectorType(32);
const PayloadStatusT = new ContainerType({
  status: U8,
  latestValidHash: new ListCompositeType(R32, 1),
  validationError: new ListCompositeType(new ByteListType(1024), 1),
});
const FcuRespT = new ContainerType({
  payloadStatus: PayloadStatusT,
  payloadId: new ListCompositeType(new ByteVectorType(8), 1),
});
const BlobT = new ByteVectorType(131072);
const B48 = new ByteVectorType(48);
const BlobsV1T = new ContainerType({
  entries: new ListCompositeType(
    new ContainerType({available: ssz.Boolean, contents: new ContainerType({blob: BlobT, proof: B48})}),
    128
  ),
});

const zero32 = new Uint8Array(32);
const zeroHex = `0x${"00".repeat(32)}`;
const validStatus = (): Uint8Array =>
  PayloadStatusT.serialize({status: 0, latestValidHash: [zero32], validationError: []});
const validFcu = (): Uint8Array =>
  FcuRespT.serialize({payloadStatus: {status: 0, latestValidHash: [zero32], validationError: []}, payloadId: []});

const executionPayloadRpc = {
  blockHash: zeroHex,
  parentHash: zeroHex,
  feeRecipient: `0x${"a9".repeat(20)}`,
  stateRoot: zeroHex,
  receiptsRoot: zeroHex,
  logsBloom: `0x${"00".repeat(256)}`,
  prevRandao: zeroHex,
  blockNumber: "0x1",
  gasLimit: "0x989680",
  gasUsed: "0x0",
  timestamp: "0x5",
  extraData: "0x",
  baseFeePerGas: "0x7",
  transactions: [],
  withdrawals: [],
  blobGasUsed: "0x0",
  excessBlobGas: "0x0",
};
const denebPayload = () => parseExecutionPayload(ForkName.deneb, executionPayloadRpc).executionPayload;
const bellatrixPayload = () =>
  parseExecutionPayload(ForkName.bellatrix, {
    ...executionPayloadRpc,
    withdrawals: undefined,
    blobGasUsed: undefined,
    excessBlobGas: undefined,
  } as never).executionPayload;

type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
type StubOpts = {
  /** undefined -> /capabilities answers 404 (legacy EL) */
  capabilities?: object;
  onJsonRpc?: (payload: RpcPayload) => Promise<unknown> | unknown;
  routes?: {method: "GET" | "POST"; path: string; handler: Handler}[];
};

function sendSsz(reply: FastifyReply, data: Uint8Array): void {
  reply.header("Content-Type", "application/octet-stream");
  reply.send(Buffer.from(data));
}

function makeSilentLogger(): Logger {
  const noop = () => undefined;
  return {debug: noop, info: noop, warn: noop, error: noop, verbose: noop} as unknown as Logger;
}

async function startEngine(
  opts: StubOpts,
  after: (() => Promise<void>)[]
): Promise<{engine: IExecutionEngine; jsonRpcCalls: string[]}> {
  const controller = new AbortController();
  const server = fastify({logger: false});
  const jsonRpcCalls: string[] = [];
  server.addContentTypeParser("application/octet-stream", {parseAs: "buffer"}, (_req, body, done) => done(null, body));

  server.post("/", async (req) => {
    const payload = req.body as RpcPayload;
    jsonRpcCalls.push(payload.method);
    if (payload.method === "engine_getClientVersionV1") {
      return {jsonrpc: "2.0", id: 1, result: [{code: "GE", name: "geth", version: "test", commit: "0x00000000"}]};
    }
    return {jsonrpc: "2.0", id: 1, result: await opts.onJsonRpc?.(payload)};
  });
  server.get("/engine/v1/capabilities", async (_req, reply) =>
    opts.capabilities ? opts.capabilities : reply.code(404).type("text/plain").send("not found")
  );
  server.get("/engine/v1/identity", async () => [{code: "GE", name: "geth", version: "test", commit: "0x00000000"}]);
  for (const r of opts.routes ?? []) {
    if (r.method === "GET") server.get(r.path, r.handler);
    else server.post(r.path, r.handler);
  }

  after.push(async () => {
    controller.abort();
    await server.close();
  });
  const url = await server.listen({host: "127.0.0.1", port: 0});
  const engine = initializeExecutionEngine(
    {mode: "http", urls: [url], retries: 0, retryDelay: defaultExecutionEngineHttpOpts.retryDelay, sszRest: true},
    {signal: controller.signal, logger: makeSilentLogger()}
  );
  return {engine, jsonRpcCalls};
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Timed out waiting for condition");
}

describe("ExecutionEngineHttp / SSZ-REST dispatch", () => {
  const after: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (after.length) await after.pop()?.();
  });

  it("uses JSON-RPC for everything when /capabilities is 404", async () => {
    let restHits = 0;
    const {engine, jsonRpcCalls} = await startEngine(
      {
        onJsonRpc: (p) =>
          p.method === "engine_newPayloadV3"
            ? {status: "VALID", latestValidHash: zeroHex, validationError: null}
            : null,
        routes: [
          {
            method: "POST",
            path: "/engine/v1/payloads",
            handler: () => {
              restHits++;
            },
          },
        ],
      },
      after
    );
    const res = await engine.notifyNewPayload(ForkName.deneb, denebPayload(), [], zero32);
    expect(res.status).toBe(ExecutionPayloadStatus.VALID);
    expect(restHits).toBe(0);
    expect(jsonRpcCalls).toContain("engine_newPayloadV3");
  });

  it("validates notifyNewPayload preconditions before dispatching to REST", async () => {
    let restHits = 0;
    const {engine} = await startEngine(
      {
        capabilities: {supported_forks: ["cancun"]},
        routes: [
          {
            method: "POST",
            path: "/engine/v1/payloads",
            handler: () => {
              restHits++;
            },
          },
        ],
      },
      after
    );
    await expect(engine.notifyNewPayload(ForkName.deneb, denebPayload(), [] /* versionedHashes */)).rejects.toThrow(
      /parentBlockRoot required/
    );
    expect(restHits).toBe(0);
    expect(engine.state).toBe(ExecutionEngineState.ONLINE);
  });

  it("routes advertised forks to REST and unadvertised forks to JSON-RPC", async () => {
    let restHits = 0;
    const {engine, jsonRpcCalls} = await startEngine(
      {
        capabilities: {supported_forks: ["cancun"]},
        onJsonRpc: (p) =>
          p.method === "engine_newPayloadV1"
            ? {status: "VALID", latestValidHash: zeroHex, validationError: null}
            : null,
        routes: [
          {
            method: "POST",
            path: "/engine/v1/payloads",
            handler: (_r, reply) => {
              restHits++;
              sendSsz(reply, validStatus());
            },
          },
        ],
      },
      after
    );
    await engine.notifyNewPayload(ForkName.deneb, denebPayload(), [], zero32);
    expect(restHits).toBe(1);
    await engine.notifyNewPayload(ForkName.bellatrix, bellatrixPayload());
    expect(restHits).toBe(1);
    expect(jsonRpcCalls).toContain("engine_newPayloadV1");
    expect(jsonRpcCalls).not.toContain("engine_newPayloadV3");
  });

  it("does not fall back to JSON-RPC on a REST error; engine state becomes SYNCING", async () => {
    const {engine, jsonRpcCalls} = await startEngine(
      {
        capabilities: {supported_forks: ["cancun"]},
        routes: [
          {
            method: "POST",
            path: "/engine/v1/forkchoice",
            handler: (_r, reply) =>
              reply
                .code(409)
                .header("Content-Type", "application/problem+json")
                .send({type: "/engine-api/errors/invalid-forkchoice"}),
          },
        ],
      },
      after
    );
    const err = await engine.notifyForkchoiceUpdate(ForkName.deneb, zeroHex, zeroHex, zeroHex).catch((e) => e);
    expect(err).toBeInstanceOf(SszRestError);
    expect(err.type).toBe("/engine-api/errors/invalid-forkchoice");
    expect(jsonRpcCalls.filter((m) => m.startsWith("engine_forkchoiceUpdated"))).toEqual([]);
    expect(engine.state).toBe(ExecutionEngineState.SYNCING);
  });

  it("REST newPayload INVALID maps to the same response as JSON-RPC and is not ELERROR", async () => {
    const {engine} = await startEngine(
      {
        capabilities: {supported_forks: ["cancun"]},
        routes: [
          {
            method: "POST",
            path: "/engine/v1/payloads",
            handler: (_r, reply) =>
              sendSsz(
                reply,
                PayloadStatusT.serialize({
                  status: 1,
                  latestValidHash: [zero32],
                  validationError: [new TextEncoder().encode("nope")],
                })
              ),
          },
        ],
      },
      after
    );
    const res = await engine.notifyNewPayload(ForkName.deneb, denebPayload(), [], zero32);
    expect(res).toEqual({status: ExecutionPayloadStatus.INVALID, latestValidHash: zeroHex, validationError: "nope"});
  });

  it("blobs: v1 partial -> null at index; revision not advertised -> JSON-RPC", async () => {
    let restHits = 0;
    const {engine, jsonRpcCalls} = await startEngine(
      {
        capabilities: {supported_forks: ["cancun"], independently_versioned: {blobs: ["v1"]}},
        onJsonRpc: (p) => (p.method === "engine_getBlobsV2" ? null : undefined),
        routes: [
          {
            method: "POST",
            path: "/engine/v1/blobs/v1",
            handler: (_r, reply) => {
              restHits++;
              sendSsz(
                reply,
                BlobsV1T.serialize({
                  entries: [
                    {available: false, contents: {blob: new Uint8Array(131072), proof: new Uint8Array(48)}},
                    {available: true, contents: {blob: new Uint8Array(131072), proof: new Uint8Array(48)}},
                  ],
                })
              );
            },
          },
        ],
      },
      after
    );
    const v1 = await engine.getBlobs(ForkName.deneb, [zero32, zero32]);
    expect(v1[0]).toBeNull();
    expect(v1[1]).not.toBeNull();
    expect(restHits).toBe(1);

    const v2 = await engine.getBlobs(ForkName.fulu, [zero32]);
    expect(v2).toBeNull();
    expect(jsonRpcCalls).toContain("engine_getBlobsV2");
  });

  it("serializes REST newPayload and forkchoiceUpdated through the engine queue", async () => {
    const events: string[] = [];
    let release = (): void => undefined;
    const {engine} = await startEngine(
      {
        capabilities: {supported_forks: ["cancun"]},
        routes: [
          {
            method: "POST",
            path: "/engine/v1/payloads",
            handler: async (_r, reply) => {
              events.push("newPayload:start");
              await new Promise<void>((resolve) => {
                release = resolve;
              });
              events.push("newPayload:end");
              sendSsz(reply, validStatus());
            },
          },
          {
            method: "POST",
            path: "/engine/v1/forkchoice",
            handler: (_r, reply) => {
              events.push("forkchoice:start");
              sendSsz(reply, validFcu());
            },
          },
        ],
      },
      after
    );
    const np = engine.notifyNewPayload(ForkName.deneb, denebPayload(), [], zero32);
    await waitUntil(() => events.includes("newPayload:start"));
    const fcu = engine.notifyForkchoiceUpdate(ForkName.deneb, zeroHex, zeroHex, zeroHex);
    await new Promise((r) => setTimeout(r, 25));
    expect(events).toEqual(["newPayload:start"]);
    release();
    await Promise.all([np, fcu]);
    expect(events).toEqual(["newPayload:start", "newPayload:end", "forkchoice:start"]);
  });
});
