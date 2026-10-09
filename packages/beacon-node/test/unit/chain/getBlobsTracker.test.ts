import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {SignedBeaconBlock, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputColumns} from "../../../src/chain/blocks/blockInput/index.js";
import {BlockInputSource} from "../../../src/chain/blocks/blockInput/types.js";
import {ChainEventEmitter} from "../../../src/chain/emitter.js";
import {
  GET_BLOBS_RETRY_INTERVAL_MS,
  GetBlobsTracker,
  MAX_GET_BLOBS_ATTEMPTS,
} from "../../../src/chain/GetBlobsTracker.js";
import {IExecutionEngine} from "../../../src/execution/index.js";

describe("GetBlobsTracker", () => {
  const config = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
  });

  let getBlobs: ReturnType<typeof vi.fn>;
  let tracker: GetBlobsTracker;

  function createBlockInput(slot: number): BlockInputColumns {
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.body.blobKzgCommitments = [new Uint8Array(48)];
    return BlockInputColumns.createFromBlock({
      block: block as SignedBeaconBlock<typeof ForkName.fulu>,
      blockRootHex: toRootHex(ssz.fulu.BeaconBlock.hashTreeRoot(block.message)),
      forkName: ForkName.fulu,
      daOutOfRange: false,
      seenTimestampSec: 0,
      source: BlockInputSource.gossip,
      sampledColumns: [0],
      custodyColumns: [0],
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    getBlobs = vi.fn().mockResolvedValue(null);
    tracker = new GetBlobsTracker({
      logger: testLogger(),
      executionEngine: {getBlobs} as unknown as IExecutionEngine,
      emitter: new ChainEventEmitter(),
      metrics: null,
      config,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the request synchronously", () => {
    tracker.triggerGetBlobs(createBlockInput(1));
    expect(getBlobs).toHaveBeenCalledTimes(1);
  });

  it("does not retry within the interval after a null answer", async () => {
    const blockInput = createBlockInput(1);
    tracker.triggerGetBlobs(blockInput);
    await vi.advanceTimersByTimeAsync(0);

    tracker.triggerGetBlobs(blockInput);
    tracker.triggerGetBlobs(blockInput);
    expect(getBlobs).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(GET_BLOBS_RETRY_INTERVAL_MS);
    tracker.triggerGetBlobs(blockInput);
    expect(getBlobs).toHaveBeenCalledTimes(2);
  });

  it("keeps one trailing retry when triggers arrive inside the interval", async () => {
    const blockInput = createBlockInput(1);
    tracker.triggerGetBlobs(blockInput);
    await vi.advanceTimersByTimeAsync(0);

    tracker.triggerGetBlobs(blockInput);
    tracker.triggerGetBlobs(blockInput);
    expect(getBlobs).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(GET_BLOBS_RETRY_INTERVAL_MS);
    expect(getBlobs).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(GET_BLOBS_RETRY_INTERVAL_MS);
    expect(getBlobs).toHaveBeenCalledTimes(2);
  });

  it("stops retrying after the maximum number of null answers", async () => {
    const blockInput = createBlockInput(1);
    for (let i = 0; i < MAX_GET_BLOBS_ATTEMPTS + 2; i++) {
      tracker.triggerGetBlobs(blockInput);
      await vi.advanceTimersByTimeAsync(GET_BLOBS_RETRY_INTERVAL_MS);
    }
    expect(getBlobs).toHaveBeenCalledTimes(MAX_GET_BLOBS_ATTEMPTS);
  });

  it("tracks failed attempts per block root", async () => {
    tracker.triggerGetBlobs(createBlockInput(1));
    await vi.advanceTimersByTimeAsync(0);
    tracker.triggerGetBlobs(createBlockInput(2));
    expect(getBlobs).toHaveBeenCalledTimes(2);
  });
});
