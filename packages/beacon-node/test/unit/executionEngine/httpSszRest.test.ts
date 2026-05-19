import {FastifyReply, FastifyRequest, fastify} from "fastify";
import {afterEach, describe, expect, it} from "vitest";
import {ByteListType, ByteVectorType, ContainerType, ListCompositeType, UintNumberType} from "@chainsafe/ssz";
import {Logger} from "@lodestar/logger";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defaultExecutionEngineHttpOpts} from "../../../src/execution/engine/http.js";
import {encodeForkchoiceUpdatedRequest} from "../../../src/execution/engine/sszRestEncoding.js";
import {parseExecutionPayload} from "../../../src/execution/engine/types.js";
import {RpcPayload} from "../../../src/execution/engine/utils.js";
import {IExecutionEngine, initializeExecutionEngine} from "../../../src/execution/index.js";

const Uint8 = new UintNumberType(1);
const Bytes8 = new ByteVectorType(8);
const Bytes20 = new ByteVectorType(20);
const Bytes32 = new ByteVectorType(32);
const NullableHash = new ListCompositeType(Bytes32, 1);
const NullablePayloadId = new ListCompositeType(Bytes8, 1);
const ValidationErrorBytes = new ByteListType(1024);

const PayloadStatusV1 = new ContainerType(
  {status: Uint8, latestValidHash: NullableHash, validationError: ValidationErrorBytes},
  {typeName: "PayloadStatusV1"}
);

const ForkchoiceUpdatedResponseV1 = new ContainerType(
  {
    payloadStatus: PayloadStatusV1,
    payloadId: NullablePayloadId,
  },
  {typeName: "ForkchoiceUpdatedResponseV1"}
);

const ForkchoiceStateV1 = new ContainerType(
  {headBlockHash: Bytes32, safeBlockHash: Bytes32, finalizedBlockHash: Bytes32},
  {typeName: "ForkchoiceStateV1"}
);

const PayloadAttributesV4 = new ContainerType(
  {
    timestamp: ssz.UintNum64,
    prevRandao: Bytes32,
    suggestedFeeRecipient: Bytes20,
    withdrawals: ssz.capella.Withdrawals,
    parentBeaconBlockRoot: Bytes32,
    slotNumber: ssz.UintNum64,
    targetGasLimit: ssz.UintNum64,
  },
  {typeName: "PayloadAttributesV4"}
);

const ForkchoiceUpdatedV4Request = new ContainerType(
  {
    forkchoiceState: ForkchoiceStateV1,
    payloadAttributes: new ListCompositeType(PayloadAttributesV4, 1),
  },
  {typeName: "ForkchoiceUpdatedV4Request"}
);

const executionPayloadRpc = {
  blockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
  parentHash: "0xa0513a503d5bd6e89a144c3268e5b7e9da9dbf63df125a360e3950a7d0d67131",
  feeRecipient: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
  stateRoot: "0xca3149fa9e37db08d1cd49c9061db1002ef1cd58db2210f2115c8c989b2bdf45",
  receiptsRoot: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
  logsBloom:
    "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  prevRandao: "0x0000000000000000000000000000000000000000000000000000000000000000",
  blockNumber: "0x1",
  gasLimit: "0x989680",
  gasUsed: "0x0",
  timestamp: "0x5",
  extraData: "0x",
  baseFeePerGas: "0x7",
  transactions: [],
};

const validExecutionPayloadRpc = {...executionPayloadRpc, logsBloom: `0x${"00".repeat(256)}`};

const forkChoiceHeadData = {
  headBlockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
  safeBlockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
  finalizedBlockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
};

describe("ExecutionEngine / SSZ-REST", () => {
  const afterCallbacks: (() => Promise<void> | void)[] = [];

  afterEach(async () => {
    while (afterCallbacks.length > 0) {
      const callback = afterCallbacks.pop();
      if (callback) await callback();
    }
  });

  it("encodes targetGasLimit in forkchoiceUpdated v4 payload attributes", () => {
    const root = new Uint8Array(32);
    const body = encodeForkchoiceUpdatedRequest(ForkName.gloas, root, root, root, {
      timestamp: 1,
      prevRandao: root,
      suggestedFeeRecipient: `0x${"11".repeat(20)}`,
      withdrawals: [],
      parentBeaconBlockRoot: root,
      slotNumber: 2,
      targetGasLimit: 30_000_000,
    });

    const parsed = ForkchoiceUpdatedV4Request.deserialize(body);

    expect(parsed.payloadAttributes[0].targetGasLimit).toBe(30_000_000);
  });

  it("does not call SSZ endpoint unless it is advertised by engine_exchangeCapabilities", async () => {
    let sszNewPayloadRequests = 0;
    let jsonRpcNewPayloadRequests = 0;

    const executionEngine = await startExecutionEngine(
      {
        capabilities: ["engine_newPayloadV1"],
        async onJsonRpc(payload) {
          if (payload.method === "engine_newPayloadV1") {
            jsonRpcNewPayloadRequests++;
            return {status: "VALID", latestValidHash: executionPayloadRpc.blockHash, validationError: null};
          }
          return [];
        },
        sszRoutes: {
          "/engine/v1/payloads": async (_req, reply) => {
            sszNewPayloadRequests++;
            reply.code(500).send("SSZ endpoint should not be called");
          },
        },
      },
      afterCallbacks
    );

    await executionEngine.notifyNewPayload(
      ForkName.bellatrix,
      parseExecutionPayload(ForkName.bellatrix, validExecutionPayloadRpc).executionPayload
    );

    expect(sszNewPayloadRequests).toBe(0);
    expect(jsonRpcNewPayloadRequests).toBe(1);
  });

  it("does not fall back to JSON-RPC when an advertised SSZ endpoint returns a semantic HTTP error", async () => {
    let jsonRpcNewPayloadRequests = 0;

    const executionEngine = await startExecutionEngine(
      {
        capabilities: ["POST /engine/v1/payloads"],
        async onJsonRpc(payload) {
          if (payload.method === "engine_newPayloadV1") {
            jsonRpcNewPayloadRequests++;
            return {status: "VALID", latestValidHash: executionPayloadRpc.blockHash, validationError: null};
          }
          return [];
        },
        sszRoutes: {
          "/engine/v1/payloads": async (_req, reply) => {
            reply.code(400).send("Malformed SSZ");
          },
        },
      },
      afterCallbacks
    );

    await expect(
      executionEngine.notifyNewPayload(
        ForkName.bellatrix,
        parseExecutionPayload(ForkName.bellatrix, validExecutionPayloadRpc).executionPayload
      )
    ).rejects.toThrow("SSZ-REST error 400: Malformed SSZ");

    expect(jsonRpcNewPayloadRequests).toBe(0);
  });

  it("uses JSON-RPC for getBlobsV1 because SSZ v1 cannot preserve null positions", async () => {
    let sszGetBlobsRequests = 0;
    let jsonRpcGetBlobsRequests = 0;

    const executionEngine = await startExecutionEngine(
      {
        capabilities: ["POST /engine/v1/blobs"],
        async onJsonRpc(payload) {
          if (payload.method === "engine_getBlobsV1") {
            jsonRpcGetBlobsRequests++;
            return [null];
          }
          return [];
        },
        sszRoutes: {
          "/engine/v1/blobs": async (_req, reply) => {
            sszGetBlobsRequests++;
            reply.code(500).send("SSZ getBlobsV1 endpoint should not be called");
          },
        },
      },
      afterCallbacks
    );

    const response = await executionEngine.getBlobs(ForkName.deneb, [new Uint8Array(32)]);

    expect(response).toEqual([null]);
    expect(sszGetBlobsRequests).toBe(0);
    expect(jsonRpcGetBlobsRequests).toBe(1);
  });

  it("serializes SSZ newPayload and forkchoiceUpdated through the Engine queue", async () => {
    const events: string[] = [];
    let releaseNewPayload = (): void => {
      throw Error("releaseNewPayload called before request started");
    };

    const executionEngine = await startExecutionEngine(
      {
        capabilities: ["POST /engine/v1/payloads", "POST /engine/v1/forkchoice"],
        sszRoutes: {
          "/engine/v1/payloads": async (_req, reply) => {
            events.push("newPayload:start");
            await new Promise<void>((resolve) => {
              releaseNewPayload = resolve;
            });
            events.push("newPayload:end");
            sendSsz(reply, validPayloadStatus());
          },
          "/engine/v1/forkchoice": async (_req, reply) => {
            events.push("forkchoice:start");
            sendSsz(reply, validForkchoiceUpdatedResponse());
          },
        },
      },
      afterCallbacks
    );

    const newPayloadPromise = executionEngine.notifyNewPayload(
      ForkName.bellatrix,
      parseExecutionPayload(ForkName.bellatrix, validExecutionPayloadRpc).executionPayload
    );

    await waitUntil(() => events.includes("newPayload:start"));

    const forkchoicePromise = executionEngine.notifyForkchoiceUpdate(
      ForkName.bellatrix,
      forkChoiceHeadData.headBlockHash,
      forkChoiceHeadData.safeBlockHash,
      forkChoiceHeadData.finalizedBlockHash
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(events).toEqual(["newPayload:start"]);

    releaseNewPayload();
    await Promise.all([newPayloadPromise, forkchoicePromise]);

    expect(events).toEqual(["newPayload:start", "newPayload:end", "forkchoice:start"]);
  });
});

type SszRouteHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void> | void;

type EngineStubOpts = {
  capabilities: string[];
  onJsonRpc?: (payload: RpcPayload) => Promise<unknown> | unknown;
  sszRoutes?: Partial<Record<string, SszRouteHandler>>;
};

async function startExecutionEngine(
  opts: EngineStubOpts,
  afterCallbacks: (() => Promise<void> | void)[]
): Promise<IExecutionEngine> {
  const controller = new AbortController();
  const server = fastify({logger: false});

  server.addContentTypeParser("application/octet-stream", {parseAs: "buffer"}, (_req, body, done) => {
    done(null, body);
  });

  server.post("/", async (req) => {
    const payload = req.body as RpcPayload;
    if (payload.method === "engine_exchangeCapabilities") {
      return {jsonrpc: "2.0", id: 1, result: opts.capabilities};
    }
    if (payload.method === "engine_getClientVersionV1") {
      return {jsonrpc: "2.0", id: 1, result: [{code: "GE", name: "geth", version: "test", commit: "0x00000000"}]};
    }
    return {jsonrpc: "2.0", id: 1, result: await opts.onJsonRpc?.(payload)};
  });

  for (const [path, handler] of Object.entries(opts.sszRoutes ?? {})) {
    if (!handler) continue;
    server.post(path, handler);
  }

  afterCallbacks.push(async () => {
    controller.abort();
    await server.close();
  });

  const baseUrl = await server.listen({host: "127.0.0.1", port: 0});

  return initializeExecutionEngine(
    {
      mode: "http",
      urls: [baseUrl],
      retries: defaultExecutionEngineHttpOpts.retries,
      retryDelay: defaultExecutionEngineHttpOpts.retryDelay,
      sszRest: true,
    },
    {signal: controller.signal, logger: console as unknown as Logger}
  );
}

function validPayloadStatus(): Uint8Array {
  return PayloadStatusV1.serialize({
    status: 0,
    latestValidHash: [new Uint8Array(32)],
    validationError: new Uint8Array(),
  });
}

function validForkchoiceUpdatedResponse(): Uint8Array {
  return ForkchoiceUpdatedResponseV1.serialize({
    payloadStatus: {
      status: 0,
      latestValidHash: [new Uint8Array(32)],
      validationError: new Uint8Array(),
    },
    payloadId: [],
  });
}

function sendSsz(reply: FastifyReply, data: Uint8Array): void {
  reply.header("Content-Type", "application/octet-stream");
  reply.send(Buffer.from(data));
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error("Timed out waiting for condition");
}
