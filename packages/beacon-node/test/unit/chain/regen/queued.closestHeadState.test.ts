import {describe, expect, it, vi} from "vitest";
import {PayloadStatus, type ProtoBlock} from "@lodestar/fork-choice";
import {QueuedStateRegenerator} from "../../../../src/chain/regen/queued.js";

function makeHead(payloadStatus: PayloadStatus): ProtoBlock {
  return {
    slot: 0,
    blockRoot: "0x11",
    parentRoot: "0x22",
    stateRoot: "0x33",
    targetRoot: "0x44",
    justifiedEpoch: 0,
    justifiedRoot: "0x55",
    finalizedEpoch: 0,
    finalizedRoot: "0x66",
    unrealizedJustifiedEpoch: 0,
    unrealizedJustifiedRoot: "0x77",
    unrealizedFinalizedEpoch: 0,
    unrealizedFinalizedRoot: "0x88",
    timeliness: true,
    payloadStatus,
    builderIndex: null,
    blockHashFromBid: null,
    parentBlockHash: null,
    executionPayloadBlockHash: null,
    executionStatus: "PreMerge",
    dataAvailabilityStatus: "PreData",
  } as unknown as ProtoBlock;
}

describe("QueuedStateRegenerator - getClosestHeadState", () => {
  it("prefers exact head state root cache hit over opposite payload variant fallback", () => {
    const oppositeVariantState = {tag: "opposite"};
    const exactHeadState = {tag: "exact-head"};

    const checkpointStateCache = {
      getLatest: vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(oppositeVariantState),
      get: vi.fn(),
      getStateOrBytes: vi.fn(),
      clear: vi.fn(),
      dumpSummary: vi.fn().mockReturnValue([]),
      prune: vi.fn(),
      pruneFinalized: vi.fn(),
      processState: vi.fn().mockResolvedValue(undefined),
      add: vi.fn(),
      updatePreComputedCheckpoint: vi.fn(),
    };

    const blockStateCache = {
      get: vi.fn().mockReturnValue(exactHeadState),
      clear: vi.fn(),
      dumpSummary: vi.fn().mockReturnValue([]),
      prune: vi.fn(),
      deleteAllBeforeEpoch: vi.fn(),
      add: vi.fn(),
      setHeadState: vi.fn(),
    };

    const regenerator = new QueuedStateRegenerator({
      signal: new AbortController().signal,
      metrics: null,
      logger: {debug: vi.fn(), warn: vi.fn(), error: vi.fn()},
      forkChoice: {} as never,
      blockStateCache: blockStateCache as never,
      checkpointStateCache: checkpointStateCache as never,
      db: {} as never,
      seenBlockInputCache: {} as never,
      config: {} as never,
      emitter: {} as never,
      validatorMonitor: null,
    });

    const head = makeHead(PayloadStatus.FULL);
    const state = regenerator.getClosestHeadState(head);

    expect(state).toBe(exactHeadState);
    expect(checkpointStateCache.getLatest).toHaveBeenCalledTimes(1);
    expect(checkpointStateCache.getLatest).toHaveBeenCalledWith(head.blockRoot, Infinity, true);
    expect(blockStateCache.get).toHaveBeenCalledWith(head.stateRoot);
  });

  it("falls back to opposite payload variant only when exact head state is unavailable", () => {
    const oppositeVariantState = {tag: "opposite"};

    const checkpointStateCache = {
      getLatest: vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(oppositeVariantState),
      get: vi.fn(),
      getStateOrBytes: vi.fn(),
      clear: vi.fn(),
      dumpSummary: vi.fn().mockReturnValue([]),
      prune: vi.fn(),
      pruneFinalized: vi.fn(),
      processState: vi.fn().mockResolvedValue(undefined),
      add: vi.fn(),
      updatePreComputedCheckpoint: vi.fn(),
    };

    const blockStateCache = {
      get: vi.fn().mockReturnValue(null),
      clear: vi.fn(),
      dumpSummary: vi.fn().mockReturnValue([]),
      prune: vi.fn(),
      deleteAllBeforeEpoch: vi.fn(),
      add: vi.fn(),
      setHeadState: vi.fn(),
    };

    const regenerator = new QueuedStateRegenerator({
      signal: new AbortController().signal,
      metrics: null,
      logger: {debug: vi.fn(), warn: vi.fn(), error: vi.fn()},
      forkChoice: {} as never,
      blockStateCache: blockStateCache as never,
      checkpointStateCache: checkpointStateCache as never,
      db: {} as never,
      seenBlockInputCache: {} as never,
      config: {} as never,
      emitter: {} as never,
      validatorMonitor: null,
    });

    const head = makeHead(PayloadStatus.FULL);
    const state = regenerator.getClosestHeadState(head);

    expect(state).toBe(oppositeVariantState);
    expect(checkpointStateCache.getLatest).toHaveBeenNthCalledWith(1, head.blockRoot, Infinity, true);
    expect(blockStateCache.get).toHaveBeenCalledWith(head.stateRoot);
    expect(checkpointStateCache.getLatest).toHaveBeenNthCalledWith(2, head.blockRoot, Infinity, false);
  });
});
