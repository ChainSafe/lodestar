import {Mock, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ApiClient, ApiError, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {testLogger} from "@lodestar/logger/test-utils";
import {BUILDER_INDEX_SELF_BUILD, ForkName} from "@lodestar/params";
import {RootHex, SignedBeaconBlock, ssz} from "@lodestar/types";
import {ErrorAborted, LogLevel, Logger, TimeoutError, toRootHex} from "@lodestar/utils";
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
  let errorLog: Mock<Logger[LogLevel.error]>;
  let warnLog: Mock<Logger[LogLevel.warn]>;
  let apiStub: ApiStub;

  beforeEach(() => {
    controller = new AbortController();
    config = getConfig(ForkName.gloas);
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
    const deferred = promiseWithResolvers<GetBlockV2Response>();
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
    apiStub.getBlockV2.mockResolvedValue(errorResponse(404));
    const observer = new BlockObserver(config, logger, apiStub.api, {retries: 5, retryDelay: 100});

    const processing = observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);
    await vi.waitFor(() => expect(apiStub.getBlockV2).toHaveBeenCalledOnce());
    controller.abort();
    await processing;

    expect(apiStub.getBlockV2).toHaveBeenCalledOnce();
    expect(errorLog).not.toHaveBeenCalled();
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
    const {onError, onClose} = apiStub.eventstream.mock.calls[0][0];

    onError?.(Error("stream failed"));
    onClose?.();
    expect(errorLog).toHaveBeenCalledOnce();

    const rejectedStub = getApiStub();
    rejectedStub.eventstream.mockRejectedValue(Error("setup failed"));
    new BlockObserver(config, logger, rejectedStub.api).start(controller.signal);
    await vi.waitFor(() => expect(errorLog).toHaveBeenCalledTimes(2));
  });

  it("isolates a callback failure and continues to the next callback", async () => {
    apiStub.getBlockV2.mockResolvedValue(blockResponse(gloasBlock()));
    const first = vi.fn(async (_block: ObservedBlock) => {
      throw Error("consumer failed");
    });
    const second = vi.fn(async (_block: ObservedBlock) => {});
    const observer = new BlockObserver(config, logger, apiStub.api);
    observer.runOnBlock(first);
    observer.runOnBlock(second);

    await observer.processBlockEvent(blockEvent(rootHex(1)), controller.signal);

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledOnce();
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

function gloasBlock(builderIndex = 7): SignedBeaconBlock<typeof ForkName.gloas> {
  const block = ssz.gloas.SignedBeaconBlock.defaultValue();
  const bid = block.message.body.signedExecutionPayloadBid.message;
  bid.builderIndex = builderIndex;
  bid.value = 1_000_000;
  bid.blockHash = rootBytes(10);
  bid.parentBlockHash = rootBytes(11);
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

function promiseWithResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}
