import {Mock, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ApiClient, ApiError, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {testLogger} from "@lodestar/logger/test-utils";
import {BUILDER_INDEX_SELF_BUILD, ForkName} from "@lodestar/params";
import {RootHex, SignedBeaconBlock, ssz} from "@lodestar/types";
import {ErrorAborted, LogLevel, Logger, TimeoutError, defer, toRootHex} from "@lodestar/utils";
import {BlockObserver, ObservedBlock, isRetryableBlockRetrievalError} from "../../../src/services/blockObserver.js";

const {EventType} = routes.events;

type BlockEvent = Parameters<BlockObserver["processBlockEvent"]>[0];
type GetBlockV2 = ApiClient["beacon"]["getBlockV2"];
type GetBlockV2Response = Awaited<ReturnType<GetBlockV2>>;
type Eventstream = ApiClient["events"]["eventstream"];
type EventstreamResponse = Awaited<ReturnType<Eventstream>>;

type ApiStub = {
  api: ApiClient;
  getBlockV2: ReturnType<typeof vi.fn<GetBlockV2>>;
  eventstream: ReturnType<typeof vi.fn<Eventstream>>;
};

describe("BlockObserver", () => {
  let controller: AbortController;
  let config: ChainForkConfig;
  const logger: Logger = testLogger("BlockObserver", {level: LogLevel.error});
  let debugLog: Mock<Logger[LogLevel.debug]>;
  let errorLog: Mock<Logger[LogLevel.error]>;
  let warnLog: Mock<Logger[LogLevel.warn]>;
  let apiStub: ApiStub;

  beforeEach(() => {
    controller = new AbortController();
    config = getConfig(ForkName.gloas);
    debugLog = vi.spyOn(logger, LogLevel.debug).mockImplementation(() => {});
    errorLog = vi.spyOn(logger, LogLevel.error).mockImplementation(() => {});
    warnLog = vi.spyOn(logger, LogLevel.warn).mockImplementation(() => {});
    apiStub = getApiStub();
  });

  afterEach(() => {
    controller.abort();
    vi.restoreAllMocks();
  });

  it("subscribes only to block events with the supplied abort signal", () => {
    const observer = new BlockObserver(config, logger, apiStub.api);

    observer.start(controller.signal);

    expect(apiStub.eventstream).toHaveBeenCalledOnce();
    expect(apiStub.eventstream.mock.calls[0][0]).toMatchObject({
      topics: [EventType.block],
      signal: controller.signal,
      onEvent: expect.any(Function),
      onError: expect.any(Function),
      onClose: expect.any(Function),
    });
  });

  it("ignores an unexpected non-block event defensively", () => {
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.start(controller.signal);
    const {onEvent} = apiStub.eventstream.mock.calls[0][0];

    onEvent({
      type: EventType.blockGossip,
      message: {slot: 0, block: rootHex(1)},
    });

    expect(apiStub.getBlockV2).not.toHaveBeenCalled();
  });

  it("dispatches a block event to a registered callback", async () => {
    const block = gloasBlock();
    apiStub.getBlockV2.mockResolvedValue(blockResponse(block));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.runOnBlock(onBlock);
    observer.start(controller.signal);
    const {onEvent} = apiStub.eventstream.mock.calls[0][0];

    onEvent({type: EventType.block, message: blockEvent(rootHex(1))});

    await vi.waitFor(() => expect(onBlock).toHaveBeenCalledOnce());
  });

  it("returns a fork-correct Gloas block and the exact signed bid reference", async () => {
    const block = gloasBlock();
    const event = blockEvent(rootHex(1));
    apiStub.getBlockV2.mockResolvedValue(blockResponse(block));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.runOnBlock(onBlock);

    await observer.processBlockEvent(event, controller.signal);

    expect(apiStub.getBlockV2).toHaveBeenCalledWith({blockId: event.block}, {signal: controller.signal});
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
    apiStub.getBlockV2.mockResolvedValue(blockResponse(block, ForkName.heze));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api);
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
    apiStub.getBlockV2.mockResolvedValue(blockResponse(gloasBlock()));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.runOnBlock(onBlock);
    const event = blockEvent(rootHex(1));

    await observer.processBlockEvent(event, controller.signal);
    await observer.processBlockEvent(event, controller.signal);

    expect(apiStub.getBlockV2).toHaveBeenCalledOnce();
    expect(onBlock).toHaveBeenCalledOnce();
  });

  it("suppresses a concurrent duplicate while retrieval is in flight", async () => {
    const deferred = defer<GetBlockV2Response>();
    apiStub.getBlockV2.mockReturnValue(deferred.promise);
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.runOnBlock(onBlock);
    const event = blockEvent(rootHex(1));

    const first = observer.processBlockEvent(event, controller.signal);
    const duplicate = observer.processBlockEvent(event, controller.signal);
    deferred.resolve(blockResponse(gloasBlock()));
    await Promise.all([first, duplicate]);

    expect(apiStub.getBlockV2).toHaveBeenCalledOnce();
    expect(onBlock).toHaveBeenCalledOnce();
  });

  it("retries two not-found responses before succeeding", async () => {
    apiStub.getBlockV2
      .mockResolvedValueOnce(errorResponse(404))
      .mockResolvedValueOnce(errorResponse(404))
      .mockResolvedValueOnce(blockResponse(gloasBlock()));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api, {retries: 2, retryDelay: 0});
    observer.runOnBlock(onBlock);

    await observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);

    expect(apiStub.getBlockV2).toHaveBeenCalledTimes(3);
    expect(onBlock).toHaveBeenCalledOnce();
  });

  it("retries a server error before succeeding", async () => {
    apiStub.getBlockV2.mockResolvedValueOnce(errorResponse(503)).mockResolvedValueOnce(blockResponse(gloasBlock()));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api, {retries: 1, retryDelay: 0});
    observer.runOnBlock(onBlock);

    await observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);

    expect(apiStub.getBlockV2).toHaveBeenCalledTimes(2);
    expect(onBlock).toHaveBeenCalledOnce();
  });

  it("retains a root after persistent not-found exhaustion", async () => {
    apiStub.getBlockV2.mockResolvedValue(errorResponse(404));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api, {retries: 2, retryDelay: 0});
    observer.runOnBlock(onBlock);
    const event = blockEvent(rootHex(1));

    await observer.processBlockEvent(event, controller.signal);
    await observer.processBlockEvent(event, controller.signal);

    expect(apiStub.getBlockV2).toHaveBeenCalledTimes(3);
    expect(onBlock).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledOnce();
  });

  it("classifies retryable retrieval errors", () => {
    expect(isRetryableBlockRetrievalError(new ApiError("not found", 404, "getBlockV2"))).toBe(true);
    expect(isRetryableBlockRetrievalError(new ApiError("unavailable", 503, "getBlockV2"))).toBe(true);
    expect(isRetryableBlockRetrievalError(new TimeoutError("request"))).toBe(true);
    expect(isRetryableBlockRetrievalError(Error("transport"))).toBe(true);
    expect(isRetryableBlockRetrievalError(new ApiError("bad request", 400, "getBlockV2"))).toBe(false);
    expect(isRetryableBlockRetrievalError(new ErrorAborted("request"))).toBe(false);
  });

  it("stops silently when aborted during a retry delay", async () => {
    const firstRequestStarted = defer<void>();
    apiStub.getBlockV2.mockImplementation(async () => {
      firstRequestStarted.resolve(undefined);
      return errorResponse(404);
    });
    const observer = new BlockObserver(config, logger, apiStub.api, {retries: 5, retryDelay: 60_000});

    const processing = observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);
    await firstRequestStarted.promise;
    controller.abort();
    await processing;

    expect(apiStub.getBlockV2).toHaveBeenCalledOnce();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("does not retry a response metadata decoding failure", async () => {
    const decodeError = Error("metadata decode failed");
    apiStub.getBlockV2.mockResolvedValue(decodeErrorResponse("meta", decodeError));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.runOnBlock(onBlock);
    const event = blockEvent(rootHex(1));

    await observer.processBlockEvent(event, controller.signal);
    await observer.processBlockEvent(event, controller.signal);

    expect(apiStub.getBlockV2).toHaveBeenCalledOnce();
    expect(onBlock).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      "Failed to process block event",
      {slot: event.slot, blockRoot: event.block},
      decodeError
    );
  });

  it("does not retry a response value decoding failure", async () => {
    const decodeError = Error("value decode failed");
    apiStub.getBlockV2.mockResolvedValue(decodeErrorResponse("value", decodeError));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.runOnBlock(onBlock);
    const event = blockEvent(rootHex(1));

    await observer.processBlockEvent(event, controller.signal);
    await observer.processBlockEvent(event, controller.signal);

    expect(apiStub.getBlockV2).toHaveBeenCalledOnce();
    expect(onBlock).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      "Failed to process block event",
      {slot: event.slot, blockRoot: event.block},
      decodeError
    );
  });

  it("does not fetch a locally pre-Gloas block", async () => {
    const preGloasConfig = getConfig(ForkName.gloas, 1);
    const observer = new BlockObserver(preGloasConfig, logger, apiStub.api);

    await observer.processBlockEvent(blockEvent(rootHex(1), 0), controller.signal);

    expect(apiStub.getBlockV2).not.toHaveBeenCalled();
  });

  it("warns and stops when response metadata is pre-Gloas", async () => {
    apiStub.getBlockV2.mockResolvedValue(blockResponse(ssz.electra.SignedBeaconBlock.defaultValue(), ForkName.electra));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.runOnBlock(onBlock);

    await observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);

    expect(warnLog).toHaveBeenCalledOnce();
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("logs a post-Gloas metadata and body-shape mismatch", async () => {
    apiStub.getBlockV2.mockResolvedValue(blockResponse(ssz.electra.SignedBeaconBlock.defaultValue()));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.runOnBlock(onBlock);

    await observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);

    expect(errorLog).toHaveBeenCalledWith("Block response version and body do not agree", {
      slot: 0,
      blockRoot: rootHex(1),
      fork: ForkName.gloas,
    });
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("logs and stops when the returned block slot does not match the event", async () => {
    const block = gloasBlock();
    block.message.slot = 1;
    apiStub.getBlockV2.mockResolvedValue(blockResponse(block));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.runOnBlock(onBlock);
    const event = blockEvent(rootHex(1));

    await observer.processBlockEvent(event, controller.signal);
    await observer.processBlockEvent(event, controller.signal);

    expect(apiStub.getBlockV2).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith("Block response slot does not match block event", {
      slot: event.slot,
      blockRoot: event.block,
      blockSlot: block.message.slot,
    });
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("reopens the oldest root after bounded-set eviction", async () => {
    apiStub.getBlockV2.mockResolvedValue(blockResponse(gloasBlock()));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api, {maxSeenBlockRoots: 2});
    observer.runOnBlock(onBlock);

    for (const id of [1, 2, 3, 1]) {
      await observer.processBlockEvent(blockEvent(rootHex(id)), controller.signal);
    }

    expect(apiStub.getBlockV2).toHaveBeenCalledTimes(4);
    expect(onBlock).toHaveBeenCalledTimes(4);
  });

  it("preserves the self-build Builder index sentinel", async () => {
    const block = gloasBlock(BUILDER_INDEX_SELF_BUILD);
    apiStub.getBlockV2.mockResolvedValue(blockResponse(block));
    const onBlock = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.runOnBlock(onBlock);

    await observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);

    expect(onBlock.mock.calls[0][0].signedBid.message.builderIndex).toBe(BUILDER_INDEX_SELF_BUILD);
  });

  it("logs event stream and subscription failures", async () => {
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.start(controller.signal);
    const {onError} = apiStub.eventstream.mock.calls[0][0];
    const streamError = Error("stream failed");

    onError?.(streamError);
    expect(errorLog).toHaveBeenCalledWith("Failed to receive block event", {}, streamError);

    const rejectedStub = getApiStub();
    const setupError = Error("setup failed");
    rejectedStub.eventstream.mockRejectedValue(setupError);
    new BlockObserver(config, logger, rejectedStub.api).start(controller.signal);
    await vi.waitFor(() => expect(errorLog).toHaveBeenCalledTimes(2));
    expect(errorLog).toHaveBeenLastCalledWith("Failed to subscribe to block events", {}, setupError);
  });

  it("reports an unexpected stream close and treats shutdown closure as debug", () => {
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.start(controller.signal);
    const {onClose} = apiStub.eventstream.mock.calls[0][0];

    onClose?.();
    expect(errorLog).toHaveBeenCalledWith("Block event stream closed unexpectedly", {});

    errorLog.mockClear();
    controller.abort();
    onClose?.();
    expect(errorLog).not.toHaveBeenCalled();
    expect(debugLog).toHaveBeenCalledWith("Closed stream for block events");
  });

  it("dispatches callbacks concurrently and isolates a callback failure", async () => {
    apiStub.getBlockV2.mockResolvedValue(blockResponse(gloasBlock()));
    const firstStarted = defer<void>();
    const releaseFirst = defer<void>();
    const callbackError = Error("consumer failed");
    const first = vi.fn(async (_block: ObservedBlock) => {
      firstStarted.resolve(undefined);
      await releaseFirst.promise;
      throw callbackError;
    });
    const second = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api);
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
    apiStub.getBlockV2.mockResolvedValue(blockResponse(gloasBlock()));
    const canceled = vi.fn(async (_block: ObservedBlock) => {
      throw new ErrorAborted("consumer");
    });
    const second = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.runOnBlock(canceled);
    observer.runOnBlock(second);

    await observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);

    expect(canceled).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("uses the same abort signal for the stream and block request", async () => {
    apiStub.getBlockV2.mockResolvedValue(blockResponse(gloasBlock()));
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.start(controller.signal);
    const eventstreamArgs = apiStub.eventstream.mock.calls[0][0];

    eventstreamArgs.onEvent({type: EventType.block, message: blockEvent(rootHex(1))});
    await vi.waitFor(() => expect(apiStub.getBlockV2).toHaveBeenCalledOnce());

    expect(eventstreamArgs.signal).toBe(controller.signal);
    expect(apiStub.getBlockV2.mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});

function getApiStub(): ApiStub {
  const getBlockV2 = vi.fn<GetBlockV2>();
  const eventstream = vi.fn<Eventstream>();
  eventstream.mockResolvedValue({} as unknown as EventstreamResponse);

  return {
    api: {
      beacon: {getBlockV2},
      events: {eventstream},
    } as unknown as ApiClient,
    getBlockV2,
    eventstream,
  };
}

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
