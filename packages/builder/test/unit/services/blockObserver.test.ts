import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ApiClient, ApiError} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {BUILDER_INDEX_SELF_BUILD, ForkName} from "@lodestar/params";
import {RootHex, SignedBeaconBlock, ssz} from "@lodestar/types";
import {ErrorAborted, FetchError, TimeoutError, defer, toRootHex} from "@lodestar/utils";
import {BlockObserver, ObservedBlock, isRetryableBlockRetrievalError} from "../../../src/services/blockObserver.js";
import {ApiClientStub, getApiClientStub} from "../utils/apiStub.js";
import {getMockedLogger} from "../utils/logger.js";

type BlockEvent = Parameters<BlockObserver["processBlockEvent"]>[0];
type GetBlockV2 = ApiClient["beacon"]["getBlockV2"];
type GetBlockV2Response = Awaited<ReturnType<GetBlockV2>>;

describe("BlockObserver", () => {
  let controller: AbortController;
  let config: ChainForkConfig;
  const logger = getMockedLogger();
  const {error: errorLog, info: infoLog, warn: warnLog} = logger;
  let api: ApiClientStub;

  beforeEach(() => {
    controller = new AbortController();
    config = getConfig(ForkName.gloas);
    api = getApiClientStub();
  });

  afterEach(() => {
    controller.abort();
    vi.resetAllMocks();
  });

  it("logs the default retrieval and deduplication limits", () => {
    new BlockObserver(config, logger, api);

    expect(infoLog).toHaveBeenCalledWith("Block observer initialized", {
      retries: 5,
      retryDelay: 200,
      maxSeenBlockRoots: 256,
    });
  });

  it("logs the configured retrieval and deduplication limits", () => {
    const options = {retries: 2, retryDelay: 50, maxSeenBlockRoots: 8};
    new BlockObserver(config, logger, api, options);

    expect(infoLog).toHaveBeenCalledWith("Block observer initialized", options);
  });

  it("dispatches a block event to a registered callback", async () => {
    const block = gloasBlock();
    api.beacon.getBlockV2.mockResolvedValue(blockResponse(block));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api);
    observer.runOnBlock(onBlock);

    await observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);

    expect(onBlock).toHaveBeenCalledOnce();
  });

  it("returns a fork-correct Gloas block and the exact signed bid reference", async () => {
    const block = gloasBlock();
    const event = blockEvent(rootHex(1));
    api.beacon.getBlockV2.mockResolvedValue(blockResponse(block));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api);
    observer.runOnBlock(onBlock);

    await observer.processBlockEvent(event, controller.signal);

    expect(api.beacon.getBlockV2).toHaveBeenCalledWith({blockId: event.block}, {signal: controller.signal});
    expect(onBlock).toHaveBeenCalledOnce();
    const observed = onBlock.mock.calls[0][0];
    expect(observed).toMatchObject({
      blockRoot: event.block,
      slot: event.slot,
      executionOptimistic: event.executionOptimistic,
      version: ForkName.gloas,
    });
    expect(observed.block).toBe(block);
    expect(observed.signedBid).toBe(block.message.body.signedExecutionPayloadBid);
  });

  it("preserves the exact fork-specific Heze signed bid", async () => {
    config = getConfig(ForkName.heze);
    const block = hezeBlock();
    const event = blockEvent(rootHex(1));
    api.beacon.getBlockV2.mockResolvedValue(blockResponse(block, ForkName.heze));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api);
    observer.runOnBlock(onBlock);

    await observer.processBlockEvent(event, controller.signal);

    expect(onBlock).toHaveBeenCalledOnce();
    const observed = onBlock.mock.calls[0][0];
    expect(observed.version).toBe(ForkName.heze);
    expect(observed.block).toBe(block);
    expect(observed.signedBid).toBe(block.message.body.signedExecutionPayloadBid);
    expect(block.message.body.signedExecutionPayloadBid.message.inclusionListBits.get(0)).toBe(true);
  });

  it("suppresses sequential duplicate block roots", async () => {
    api.beacon.getBlockV2.mockResolvedValue(blockResponse(gloasBlock()));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api);
    observer.runOnBlock(onBlock);
    const event = blockEvent(rootHex(1));

    await observer.processBlockEvent(event, controller.signal);
    await observer.processBlockEvent(event, controller.signal);

    expect(api.beacon.getBlockV2).toHaveBeenCalledOnce();
    expect(onBlock).toHaveBeenCalledOnce();
  });

  it("suppresses a concurrent duplicate while retrieval is in flight", async () => {
    const deferred = defer<GetBlockV2Response>();
    api.beacon.getBlockV2.mockReturnValue(deferred.promise);
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api);
    observer.runOnBlock(onBlock);
    const event = blockEvent(rootHex(1));

    const first = observer.processBlockEvent(event, controller.signal);
    const duplicate = observer.processBlockEvent(event, controller.signal);
    deferred.resolve(blockResponse(gloasBlock()));
    await Promise.all([first, duplicate]);

    expect(api.beacon.getBlockV2).toHaveBeenCalledOnce();
    expect(onBlock).toHaveBeenCalledOnce();
  });

  it("retries two not-found responses before succeeding", async () => {
    api.beacon.getBlockV2
      .mockResolvedValueOnce(errorResponse(404))
      .mockResolvedValueOnce(errorResponse(404))
      .mockResolvedValueOnce(blockResponse(gloasBlock()));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api, {retries: 2, retryDelay: 0});
    observer.runOnBlock(onBlock);

    await observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);

    expect(api.beacon.getBlockV2).toHaveBeenCalledTimes(3);
    expect(onBlock).toHaveBeenCalledOnce();
  });

  it("does not dispatch a block returned after shutdown", async () => {
    const pending = defer<GetBlockV2Response>();
    api.beacon.getBlockV2.mockReturnValue(pending.promise);
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api);
    observer.runOnBlock(onBlock);

    const processing = observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);
    expect(api.beacon.getBlockV2).toHaveBeenCalledOnce();
    controller.abort();
    pending.resolve(blockResponse(gloasBlock()));
    await processing;

    expect(onBlock).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("retries a server error before succeeding", async () => {
    api.beacon.getBlockV2.mockResolvedValueOnce(errorResponse(503)).mockResolvedValueOnce(blockResponse(gloasBlock()));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api, {retries: 1, retryDelay: 0});
    observer.runOnBlock(onBlock);

    await observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);

    expect(api.beacon.getBlockV2).toHaveBeenCalledTimes(2);
    expect(onBlock).toHaveBeenCalledOnce();
  });

  it("retains a root after persistent not-found exhaustion", async () => {
    api.beacon.getBlockV2.mockResolvedValue(errorResponse(404));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api, {retries: 2, retryDelay: 0});
    observer.runOnBlock(onBlock);
    const event = blockEvent(rootHex(1));

    await observer.processBlockEvent(event, controller.signal);
    await observer.processBlockEvent(event, controller.signal);

    expect(api.beacon.getBlockV2).toHaveBeenCalledTimes(3);
    expect(onBlock).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledOnce();
  });

  it("classifies retryable retrieval errors", () => {
    const fetchFailure = new FetchError(
      "http://127.0.0.1:9596",
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9596"), {code: "ECONNREFUSED"}),
      })
    );
    const inputError = new FetchError(
      "invalid-url",
      new TypeError("Failed to parse URL from invalid-url", {
        cause: Object.assign(new Error("Invalid URL"), {input: "invalid-url", code: "ERR_INVALID_URL"}),
      })
    );

    expect(isRetryableBlockRetrievalError(new ApiError("not found", 404, "getBlockV2"))).toBe(true);
    expect(isRetryableBlockRetrievalError(new ApiError("unavailable", 503, "getBlockV2"))).toBe(true);
    expect(isRetryableBlockRetrievalError(new TimeoutError("request"))).toBe(true);
    expect(isRetryableBlockRetrievalError(fetchFailure)).toBe(true);
    expect(isRetryableBlockRetrievalError(new ApiError("bad request", 400, "getBlockV2"))).toBe(false);
    expect(isRetryableBlockRetrievalError(inputError)).toBe(false);
    expect(isRetryableBlockRetrievalError(Error("decode failed"))).toBe(false);
    expect(isRetryableBlockRetrievalError(new ErrorAborted("request"))).toBe(false);
  });

  it("does not retry a request decoding failure", async () => {
    const decodeError = Error("response decode failed");
    api.beacon.getBlockV2.mockRejectedValue(decodeError);
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api, {retries: 2, retryDelay: 0});
    observer.runOnBlock(onBlock);
    const event = blockEvent(rootHex(1));

    await observer.processBlockEvent(event, controller.signal);
    await observer.processBlockEvent(event, controller.signal);

    expect(api.beacon.getBlockV2).toHaveBeenCalledOnce();
    expect(onBlock).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      "Failed to retrieve block referenced by block event",
      {slot: event.slot, blockRoot: event.block},
      decodeError
    );
  });

  it("stops silently when aborted during a retry delay", async () => {
    const firstRequestStarted = defer<void>();
    api.beacon.getBlockV2.mockImplementation(async () => {
      firstRequestStarted.resolve(undefined);
      return errorResponse(404);
    });
    const observer = new BlockObserver(config, logger, api, {retries: 5, retryDelay: 60_000});

    const processing = observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);
    await firstRequestStarted.promise;
    controller.abort();
    await processing;

    expect(api.beacon.getBlockV2).toHaveBeenCalledOnce();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("does not retry a response metadata decoding failure", async () => {
    const decodeError = Error("metadata decode failed");
    api.beacon.getBlockV2.mockResolvedValue(decodeErrorResponse("meta", decodeError));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api);
    observer.runOnBlock(onBlock);
    const event = blockEvent(rootHex(1));

    await observer.processBlockEvent(event, controller.signal);
    await observer.processBlockEvent(event, controller.signal);

    expect(api.beacon.getBlockV2).toHaveBeenCalledOnce();
    expect(onBlock).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      "Failed to process block event",
      {slot: event.slot, blockRoot: event.block},
      decodeError
    );
  });

  it("does not retry a response value decoding failure", async () => {
    const decodeError = Error("value decode failed");
    api.beacon.getBlockV2.mockResolvedValue(decodeErrorResponse("value", decodeError));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api);
    observer.runOnBlock(onBlock);
    const event = blockEvent(rootHex(1));

    await observer.processBlockEvent(event, controller.signal);
    await observer.processBlockEvent(event, controller.signal);

    expect(api.beacon.getBlockV2).toHaveBeenCalledOnce();
    expect(onBlock).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      "Failed to process block event",
      {slot: event.slot, blockRoot: event.block},
      decodeError
    );
  });

  it("does not fetch a locally pre-Gloas block", async () => {
    const preGloasConfig = getConfig(ForkName.gloas, 1);
    const observer = new BlockObserver(preGloasConfig, logger, api);

    await observer.processBlockEvent(blockEvent(rootHex(1), 0), controller.signal);

    expect(api.beacon.getBlockV2).not.toHaveBeenCalled();
  });

  it("warns and stops when response metadata is pre-Gloas", async () => {
    api.beacon.getBlockV2.mockResolvedValue(
      blockResponse(ssz.electra.SignedBeaconBlock.defaultValue(), ForkName.electra)
    );
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api);
    observer.runOnBlock(onBlock);

    await observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);

    expect(warnLog).toHaveBeenCalledOnce();
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("warns about a post-Gloas metadata and body-shape mismatch", async () => {
    api.beacon.getBlockV2.mockResolvedValue(blockResponse(ssz.electra.SignedBeaconBlock.defaultValue()));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api);
    observer.runOnBlock(onBlock);

    await observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);

    expect(warnLog).toHaveBeenCalledWith("Block response version and body do not agree", {
      slot: 0,
      blockRoot: rootHex(1),
      fork: ForkName.gloas,
    });
    expect(errorLog).not.toHaveBeenCalled();
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("warns and stops when the returned block slot does not match the event", async () => {
    const block = gloasBlock();
    block.message.slot = 1;
    api.beacon.getBlockV2.mockResolvedValue(blockResponse(block));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api);
    observer.runOnBlock(onBlock);
    const event = blockEvent(rootHex(1));

    await observer.processBlockEvent(event, controller.signal);
    await observer.processBlockEvent(event, controller.signal);

    expect(api.beacon.getBlockV2).toHaveBeenCalledOnce();
    expect(warnLog).toHaveBeenCalledWith("Block response slot does not match block event", {
      slot: event.slot,
      blockRoot: event.block,
      blockSlot: block.message.slot,
    });
    expect(errorLog).not.toHaveBeenCalled();
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("reopens the oldest root after bounded-set eviction", async () => {
    api.beacon.getBlockV2.mockResolvedValue(blockResponse(gloasBlock()));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api, {maxSeenBlockRoots: 2});
    observer.runOnBlock(onBlock);

    for (const id of [1, 2, 3, 1]) {
      await observer.processBlockEvent(blockEvent(rootHex(id)), controller.signal);
    }

    expect(api.beacon.getBlockV2).toHaveBeenCalledTimes(4);
    expect(onBlock).toHaveBeenCalledTimes(4);
  });

  it("preserves the self-build Builder index sentinel", async () => {
    const block = gloasBlock(BUILDER_INDEX_SELF_BUILD);
    api.beacon.getBlockV2.mockResolvedValue(blockResponse(block));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api);
    observer.runOnBlock(onBlock);

    await observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);

    expect(onBlock.mock.calls[0][0].signedBid.message.builderIndex).toBe(BUILDER_INDEX_SELF_BUILD);
  });

  it("dispatches callbacks concurrently and isolates a callback failure", async () => {
    api.beacon.getBlockV2.mockResolvedValue(blockResponse(gloasBlock()));
    const firstStarted = defer<void>();
    const releaseFirst = defer<void>();
    const callbackError = Error("consumer failed");
    const first = vi.fn(async (_block: ObservedBlock) => {
      firstStarted.resolve(undefined);
      await releaseFirst.promise;
      throw callbackError;
    });
    const second = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api);
    observer.runOnBlock(first);
    observer.runOnBlock(second);

    const processing = observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);

    await firstStarted.promise;
    expect(second).toHaveBeenCalledOnce();
    releaseFirst.resolve(undefined);
    await processing;

    expect(errorLog).toHaveBeenCalledWith(
      "Failed to process observed block",
      {slot: 0, blockRoot: rootHex(1)},
      callbackError
    );
  });

  it("isolates callback cancellation without terminal error noise", async () => {
    api.beacon.getBlockV2.mockResolvedValue(blockResponse(gloasBlock()));
    const canceled = vi.fn(async (_block: ObservedBlock) => {
      throw new ErrorAborted("consumer");
    });
    const second = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, api);
    observer.runOnBlock(canceled);
    observer.runOnBlock(second);

    await observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);

    expect(canceled).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(errorLog).not.toHaveBeenCalled();
  });
});

function blockResponse(
  block: SignedBeaconBlock = gloasBlock(),
  version: ForkName = ForkName.gloas
): GetBlockV2Response {
  return {
    assertOk: () => {},
    meta: () => ({executionOptimistic: false, finalized: false, version}),
    value: () => block,
  } as unknown as GetBlockV2Response;
}

function errorResponse(status: number): GetBlockV2Response {
  return {
    assertOk: () => {
      throw new ApiError("request failed", status, "getBlockV2");
    },
  } as unknown as GetBlockV2Response;
}

function decodeErrorResponse(accessor: "meta" | "value", error: Error): GetBlockV2Response {
  return {
    assertOk: () => {},
    meta: () => {
      if (accessor === "meta") {
        throw error;
      }

      return {executionOptimistic: false, finalized: false, version: ForkName.gloas};
    },
    value: () => {
      if (accessor === "value") {
        throw error;
      }

      return gloasBlock();
    },
  } as unknown as GetBlockV2Response;
}

function gloasBlock(builderIndex = 7): SignedBeaconBlock<typeof ForkName.gloas> {
  const block = ssz.gloas.SignedBeaconBlock.defaultValue();
  const bid = block.message.body.signedExecutionPayloadBid.message;
  bid.builderIndex = builderIndex;
  bid.value = 1_000_000;
  bid.blockHash = rootBytes(10);
  bid.parentBlockHash = rootBytes(11);
  return block;
}

function hezeBlock(): SignedBeaconBlock<typeof ForkName.heze> {
  const block = ssz.heze.SignedBeaconBlock.defaultValue();
  const bid = block.message.body.signedExecutionPayloadBid.message;
  bid.builderIndex = 7;
  bid.value = 1_000_000;
  bid.blockHash = rootBytes(10);
  bid.parentBlockHash = rootBytes(11);
  bid.inclusionListBits.set(0, true);
  return block;
}

function blockEvent(block: RootHex, slot = 0): BlockEvent {
  return {slot, block, executionOptimistic: false};
}

function rootHex(id: number): RootHex {
  return toRootHex(rootBytes(id));
}

function rootBytes(id: number): Uint8Array {
  return Uint8Array.from({length: 32}, () => id);
}
