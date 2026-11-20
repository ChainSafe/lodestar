import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
  type EngineApiRpcReturnTypes,
  ErrorJsonRpcResponse,
  JsonRpcHttpClient,
  serializePayloadAttributes,
} from "@lodestar/beacon-node";
import type {BuildRequest} from "@lodestar/builder";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ErrorAborted, TimeoutError, toRootHex} from "@lodestar/utils";
import {
  TestingPayloadErrorCode,
  TestingPayloadSource,
  parseTransactionsPlan,
} from "../../../../src/cmds/builder/testingPayloadSource.js";

type PayloadResponse = EngineApiRpcReturnTypes["engine_getPayloadV6"];

function buildRequest(): BuildRequest {
  return {
    fork: ForkName.gloas,
    forkchoiceState: {
      headBlockHash: toRootHex(Buffer.alloc(32, 1)),
      safeBlockHash: toRootHex(Buffer.alloc(32, 2)),
      finalizedBlockHash: toRootHex(Buffer.alloc(32, 3)),
    },
    payloadAttributes: {
      ...ssz.gloas.PayloadAttributes.defaultValue(),
      timestamp: 1_787_212_236,
      slotNumber: 12,
      targetGasLimit: 200_000_000n,
      suggestedFeeRecipient: "0x" + "11".repeat(20),
      prevRandao: Buffer.alloc(32, 4),
      parentBeaconBlockRoot: Buffer.alloc(32, 5),
      withdrawals: [{index: 1, validatorIndex: 2, address: Buffer.alloc(20, 6), amount: 3n}],
    },
  };
}

function payloadResponse(request: BuildRequest, transactions = ["0x01aa", "0x02bb"]): PayloadResponse {
  const attrs = serializePayloadAttributes(request.payloadAttributes);
  return {
    executionPayload: {
      parentHash: request.forkchoiceState.headBlockHash,
      feeRecipient: attrs.suggestedFeeRecipient,
      stateRoot: "0x" + "22".repeat(32),
      receiptsRoot: "0x" + "33".repeat(32),
      logsBloom: "0x" + "00".repeat(256),
      prevRandao: attrs.prevRandao,
      blockNumber: "0x1",
      gasLimit: "0xbebc200",
      gasUsed: "0x1234",
      timestamp: attrs.timestamp,
      extraData: "0x",
      baseFeePerGas: "0x7",
      blockHash: "0x" + "44".repeat(32),
      transactions,
      withdrawals: attrs.withdrawals,
      blobGasUsed: "0x0",
      excessBlobGas: "0x0",
      blockAccessList: "0xc0",
      slotNumber: attrs.slotNumber,
    },
    blockValue: "0x10000000000000001",
    blobsBundle: {blobs: [], proofs: [], commitments: []},
    executionRequests: [],
    shouldOverrideBuilder: false,
  };
}

describe("TestingPayloadSource", () => {
  let directory: string;
  let transactionsFile: string;
  let source: TestingPayloadSource;
  let request: BuildRequest;
  const rpc = new JsonRpcHttpClient(["http://127.0.0.1:1"]);
  const fetch = vi.spyOn(rpc, "fetch");
  const signal = new AbortController().signal;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "lodestar-testing-payload-"));
    transactionsFile = path.join(directory, "transactions.json");
    await writeFile(transactionsFile, JSON.stringify({transactions: ["0x01aa", "0x02bb"]}));
    request = buildRequest();
    fetch.mockReset();
    source = new TestingPayloadSource("testing", rpc, {
      transactionsFile,
      outputDir: path.join(directory, "captures"),
    });
  });

  afterEach(async () => {
    await rm(directory, {recursive: true, force: true});
  });

  it("builds exact transactions with all attributes and captures the replayable RPC exchange", async () => {
    const response = payloadResponse(request);
    fetch.mockResolvedValueOnce({hash: request.forkchoiceState.headBlockHash}).mockResolvedValueOnce(response);

    const handle = await source.prepare(request, signal);
    const built = await source.getPayload(handle, signal);

    expect(fetch).toHaveBeenNthCalledWith(2, {
      method: "testing_buildBlockV1",
      params: [
        request.forkchoiceState.headBlockHash,
        serializePayloadAttributes(request.payloadAttributes),
        ["0x01aa", "0x02bb"],
        "0x",
      ],
    });
    expect(built.executionPayloadValue).toBe(0x10000000000000001n);
    expect(built.executionPayload.blockAccessList).toEqual(Uint8Array.of(0xc0));
    expect(built.executionRequests).toEqual(ssz.gloas.ExecutionRequests.defaultValue());
    const files = await readdir(path.join(directory, "captures"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.json$/);
    const capture = JSON.parse(await readFile(path.join(directory, "captures", files[0]), "utf8"));
    expect(capture).toMatchObject({
      fork: ForkName.gloas,
      forkchoiceState: request.forkchoiceState,
      aborted: false,
      request: JSON.parse(JSON.stringify(fetch.mock.calls[1][0])),
      response,
    });
    await expect(source.getPayload(handle, signal)).rejects.toMatchObject({
      type: {code: TestingPayloadErrorCode.UNKNOWN_HANDLE},
    });
  });

  it("keeps an explicit empty list instead of selecting the transaction pool", async () => {
    await writeFile(transactionsFile, JSON.stringify({transactions: []}));
    fetch
      .mockResolvedValueOnce({hash: request.forkchoiceState.headBlockHash})
      .mockResolvedValueOnce(payloadResponse(request, []));
    const handle = await source.prepare(request, signal);
    expect(fetch.mock.calls[1][0].params).toEqual([
      request.forkchoiceState.headBlockHash,
      serializePayloadAttributes(request.payloadAttributes),
      [],
      "0x",
    ]);
    expect((await source.getPayload(handle, signal)).executionPayload.transactions).toHaveLength(0);
  });

  it("retries a parent that becomes available without changing forkchoice", async () => {
    fetch.mockResolvedValueOnce({hash: "0x" + "00".repeat(32)});
    await expect(source.prepare(request, signal)).rejects.toMatchObject({
      type: {code: TestingPayloadErrorCode.PARENT_UNAVAILABLE},
    });
    fetch
      .mockResolvedValueOnce({hash: request.forkchoiceState.headBlockHash})
      .mockResolvedValueOnce(payloadResponse(request));
    await source.prepare(request, signal);
    expect(fetch.mock.calls.map(([call]) => call.method)).toEqual([
      "eth_getBlockByNumber",
      "eth_getBlockByNumber",
      "testing_buildBlockV1",
    ]);
  });

  it("keeps the EL busy until a late build completes and never returns its expired result", async () => {
    let resolveBuild!: (response: PayloadResponse) => void;
    const pending = new Promise<PayloadResponse>((resolve) => {
      resolveBuild = resolve;
    });
    fetch.mockResolvedValueOnce({hash: request.forkchoiceState.headBlockHash}).mockReturnValueOnce(pending);
    const controller = new AbortController();
    const build = source.prepare(request, controller.signal);
    const rejected = expect(build).rejects.toBeInstanceOf(ErrorAborted);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    controller.abort();
    const next = buildRequest();
    next.payloadAttributes.slotNumber++;
    await expect(source.prepare(next, signal)).rejects.toMatchObject({
      type: {code: TestingPayloadErrorCode.BUILD_IN_PROGRESS},
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    resolveBuild(payloadResponse(request));
    await rejected;
    const files = await readdir(path.join(directory, "captures"));
    const capture = JSON.parse(await readFile(path.join(directory, "captures", files[0]), "utf8"));
    expect(capture.aborted).toBe(true);
    fetch
      .mockResolvedValueOnce({hash: next.forkchoiceState.headBlockHash})
      .mockResolvedValueOnce(payloadResponse(next));
    await source.prepare(next, signal);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("does not retry an expensive failed build for the same request", async () => {
    const error = new ErrorJsonRpcResponse(
      {jsonrpc: "2.0", id: 1, error: {code: -32000, message: "invalid transaction"}},
      "testing_buildBlockV1"
    );
    fetch.mockResolvedValueOnce({hash: request.forkchoiceState.headBlockHash}).mockRejectedValueOnce(error);
    await expect(source.prepare(request, signal)).rejects.toBe(error);
    await expect(source.prepare(request, signal)).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not rebuild if capture fails after the EL completed", async () => {
    await writeFile(path.join(directory, "captures"), "not a directory");
    fetch
      .mockResolvedValueOnce({hash: request.forkchoiceState.headBlockHash})
      .mockResolvedValueOnce(payloadResponse(request));
    await expect(source.prepare(request, signal)).rejects.toMatchObject({code: "EEXIST"});
    await expect(source.prepare(request, signal)).rejects.toMatchObject({code: "EEXIST"});
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["transport", new TimeoutError()],
    [
      "server RPC",
      new ErrorJsonRpcResponse(
        {jsonrpc: "2.0", id: 1, error: {code: -32002, message: "request timed out"}},
        "testing_buildBlockV1"
      ),
    ],
  ])("stops controlled builds if a %s timeout leaves EL completion unknown", async (_name, error) => {
    fetch.mockResolvedValueOnce({hash: request.forkchoiceState.headBlockHash}).mockRejectedValueOnce(error);
    await expect(source.prepare(request, signal)).rejects.toBe(error);
    request.payloadAttributes.slotNumber++;
    await expect(source.prepare(request, signal)).rejects.toMatchObject({
      type: {code: TestingPayloadErrorCode.COMPLETION_UNKNOWN},
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "parent",
      (r: PayloadResponse) => {
        r.executionPayload.parentHash = "0x" + "ff".repeat(32);
      },
    ],
    [
      "slot",
      (r: PayloadResponse) => {
        r.executionPayload.slotNumber = "0xff";
      },
    ],
    [
      "timestamp",
      (r: PayloadResponse) => {
        r.executionPayload.timestamp = "0xff";
      },
    ],
    [
      "randomness",
      (r: PayloadResponse) => {
        r.executionPayload.prevRandao = "0x" + "ff".repeat(32);
      },
    ],
    [
      "fee recipient",
      (r: PayloadResponse) => {
        r.executionPayload.feeRecipient = "0x" + "ff".repeat(20);
      },
    ],
    [
      "withdrawals",
      (r: PayloadResponse) => {
        r.executionPayload.withdrawals = [];
      },
    ],
    [
      "extra data",
      (r: PayloadResponse) => {
        r.executionPayload.extraData = "0x01";
      },
    ],
    [
      "transaction order",
      (r: PayloadResponse) => {
        r.executionPayload.transactions.reverse();
      },
    ],
    [
      "blob gas",
      (r: PayloadResponse) => {
        r.executionPayload.blobGasUsed = "0x20000";
      },
    ],
    [
      "requests",
      (r: PayloadResponse) => {
        r.executionRequests = undefined;
      },
    ],
  ])("rejects an unexpected %s", async (_name, mutate) => {
    const response = payloadResponse(request);
    mutate(response);
    fetch.mockResolvedValueOnce({hash: request.forkchoiceState.headBlockHash}).mockResolvedValueOnce(response);
    await expect(source.prepare(request, signal)).rejects.toMatchObject({
      type: {code: TestingPayloadErrorCode.RESPONSE_MISMATCH},
    });
  });

  it("does not build a plan bound to a different slot", async () => {
    await writeFile(transactionsFile, JSON.stringify({transactions: [], slotNumber: 99}));
    await expect(source.prepare(request, signal)).rejects.toMatchObject({
      type: {code: TestingPayloadErrorCode.PLAN_MISMATCH},
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a cancelled request before starting RPC work", async () => {
    await expect(source.prepare(request, AbortSignal.abort())).rejects.toBeInstanceOf(ErrorAborted);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects forks whose testing build attributes are not supported", async () => {
    request.fork = ForkName.heze;
    await expect(source.prepare(request, signal)).rejects.toMatchObject({
      type: {code: TestingPayloadErrorCode.UNSUPPORTED_FORK},
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("parseTransactionsPlan", () => {
  it.each([
    null,
    [],
    {transactions: null},
    {transactions: ["0x"]},
    {transactions: ["0x123"]},
    {transactions: ["0x03abcd"]},
    {transactions: [], extraData: "0x" + "ff".repeat(33)},
    {transactions: [], parentHash: "0x01"},
    {transactions: [], slotNumber: -1},
  ])("rejects an invalid plan %j", (plan) => {
    expect(() => parseTransactionsPlan(plan)).toThrow(
      expect.objectContaining({type: expect.objectContaining({code: TestingPayloadErrorCode.INVALID_PLAN})})
    );
  });
});
