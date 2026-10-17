import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {ImportBlockResult} from "../../../../src/chain/beaconEngine/interface.js";
import {blockFailureFromError} from "../../../../src/chain/beaconEngine/processingResult.js";
import {BlockInputPreData, BlockInputSource} from "../../../../src/chain/blocks/blockInput/index.js";
import {BlockSerializedCache} from "../../../../src/chain/blocks/blockSerializedCache.js";
import {importBlock} from "../../../../src/chain/blocks/importBlock.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/blockError.js";
import {RegistryMetricCreator} from "../../../../src/metrics/index.js";
import {createLodestarMetrics} from "../../../../src/metrics/metrics/lodestar.js";
import * as eventLoop from "../../../../src/util/eventLoop.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedBeaconChain, withBeaconEngineFacade} from "../../../mocks/mockedBeaconChain.js";
import {zeroProtoBlock} from "../../../utils/state.js";

describe.each([false, true])("BeaconChain block cache cleanup (beaconEngineWorker=%s)", (beaconEngineWorker) => {
  const block = ssz.phase0.SignedBeaconBlock.defaultValue();
  const blockRootHex = toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
  const blockBytes = ssz.phase0.SignedBeaconBlock.serialize(block);
  const blockInput = BlockInputPreData.createFromBlock({
    block,
    blockRootHex,
    forkName: ForkName.phase0,
    daOutOfRange: false,
    source: BlockInputSource.gossip,
    seenTimestampSec: 0,
  });
  const importResult: ImportBlockResult = {
    headChanged: false,
    head: null,
    blockSummary: null,
    newHead: zeroProtoBlock,
    proposerIndexNextSlot: null,
    isExecutionState: false,
    prevFinalizedEpoch: 0,
    currFinalizedEpoch: 0,
    oldHeadBlockRoot: blockRootHex,
    newHeadBlockRoot: blockRootHex,
    blockMeta: {slot: 0, blockRootHex, proposerBalanceDelta: 0, parentBlockSlot: 0, seenTimestampSec: 0},
  };
  let chain: ReturnType<typeof getMockedBeaconChain>;
  let engineImport: ReturnType<typeof defer<ImportBlockResult>>;
  let sidecarWrite: ReturnType<typeof defer<void>>;
  let engineCache: BlockSerializedCache;
  let register: RegistryMetricCreator;

  beforeEach(() => {
    chain = getMockedBeaconChain();
    chain.opts.beaconEngineWorker = beaconEngineWorker;
    register = new RegistryMetricCreator();
    const metrics = createLodestarMetrics(register).blockSerializedCache;
    const blockSerializedCache = new BlockSerializedCache(chain.config, {
      owner: beaconEngineWorker ? "chain" : "shared",
      metrics,
    });
    Object.defineProperty(chain, "blockSerializedCache", {value: blockSerializedCache});
    engineCache = beaconEngineWorker
      ? new BlockSerializedCache(chain.config, {owner: "engine", metrics})
      : blockSerializedCache;
    engineImport = defer<ImportBlockResult>();
    sidecarWrite = defer<void>();
    chain.beaconEngine.importBlock = vi.fn().mockImplementation(async () => {
      const result = await engineImport.promise;
      engineCache.delete(blockRootHex, undefined, "persisted");
      return {err: null, result};
    });
    Object.defineProperty(chain, "clock", {value: new ClockStopped(0)});
    Object.defineProperty(chain, "unfinalizedBlockWrites", {
      value: {
        waitForSpace: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockReturnValue(sidecarWrite.promise),
      },
    });
    vi.spyOn(eventLoop, "callInNextEventLoop").mockImplementation(() => {});
    chain.blockSerializedCache.set(blockRootHex, ssz.phase0.SignedBeaconBlock.deserialize(blockBytes), blockBytes);
    engineCache.set(blockRootHex, block, blockBytes);
  });

  afterEach(() => {
    sidecarWrite.resolve();
    vi.restoreAllMocks();
  });

  it("clears the main-thread entry after engine import while sidecar writes are still pending", async () => {
    const importing = importBlock.call(withBeaconEngineFacade(chain), blockInput, DataAvailabilityStatus.PreData, {});
    await vi.waitFor(() => expect(chain.beaconEngine.importBlock).toHaveBeenCalledOnce());
    expect(chain.blockSerializedCache.get(blockRootHex)).toBeDefined();

    engineImport.resolve(importResult);
    await importing;

    expect(chain.blockSerializedCache.get(blockRootHex)).toBeUndefined();
    expect(engineCache.get(blockRootHex)).toBeUndefined();
    const misses = register.getSingleMetric("lodestar_block_cache_delete_misses_total");
    expect((await misses?.get())?.values).toEqual([]);
    expect(chain.seenBlockInputCache.prune).not.toHaveBeenCalled();
  });

  it("retains the main-thread entry when engine import fails", async () => {
    const cached = chain.blockSerializedCache.get(blockRootHex);
    const error = new Error("Engine import failed");
    const importing = importBlock.call(withBeaconEngineFacade(chain), blockInput, DataAvailabilityStatus.PreData, {});
    const rejected = expect(importing).rejects.toBe(error);
    await vi.waitFor(() => expect(chain.beaconEngine.importBlock).toHaveBeenCalledOnce());

    engineImport.reject(error);
    await rejected;

    expect(chain.blockSerializedCache.get(blockRootHex)).toBe(cached);
    expect(engineCache.get(blockRootHex)).toBeDefined();
    expect(chain.seenBlockInputCache.prune).not.toHaveBeenCalled();
  });

  it("rehydrates a cloned typed failure without applying successful-import cleanup", async () => {
    const error = new BlockError(block, {code: BlockErrorCode.ALREADY_KNOWN, root: blockRootHex});
    const roots = [ssz.phase0.BeaconBlock.hashTreeRoot(block.message)];
    chain.beaconEngine.importBlock = vi
      .fn()
      .mockResolvedValue(structuredClone({err: blockFailureFromError(error, chain.config, roots)}));
    const cached = chain.blockSerializedCache.get(blockRootHex);
    const importing = importBlock.call(withBeaconEngineFacade(chain), blockInput, DataAvailabilityStatus.PreData, {});
    await expect(importing).rejects.toBeInstanceOf(BlockError);
    await importing.catch((failure: BlockError) => {
      expect(failure.signedBlock).toBe(block);
      expect(failure.type).toEqual(error.type);
      expect(failure.stack).toBe(error.stack);
    });
    expect(chain.beaconEngine.importBlock).toHaveBeenCalledExactlyOnceWith(
      roots[0],
      DataAvailabilityStatus.PreData,
      {}
    );
    expect(chain.blockSerializedCache.get(blockRootHex)).toBe(cached);
    expect(chain.seenBlockInputCache.prune).not.toHaveBeenCalled();
  });
});
