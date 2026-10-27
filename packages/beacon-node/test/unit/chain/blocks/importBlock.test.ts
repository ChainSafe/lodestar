import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {defer, fromHex, toRootHex} from "@lodestar/utils";
import {toChainViewBlockBytes} from "../../../../src/chain/beaconEngine/chainView.js";
import {ImportBlockResponse} from "../../../../src/chain/beaconEngine/interface.js";
import {BeaconEngineMode} from "../../../../src/chain/beaconEngine/options.js";
import {blockFailureFromError} from "../../../../src/chain/beaconEngine/processingResult.js";
import {BlockInputPreData, BlockInputSource} from "../../../../src/chain/blocks/blockInput/index.js";
import {BlockSerializedCache} from "../../../../src/chain/blocks/blockSerializedCache.js";
import {importBlock} from "../../../../src/chain/blocks/importBlock.js";
import {computeSignedBlockRoot, toSignedBlockRootHex} from "../../../../src/chain/blocks/signedBlockRoot.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/blockError.js";
import * as eventLoop from "../../../../src/util/eventLoop.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedBeaconChain, withBeaconEngineFacade} from "../../../mocks/mockedBeaconChain.js";
import {zeroProtoBlock} from "../../../utils/state.js";

const engineModes = [BeaconEngineMode.MainThread, BeaconEngineMode.Worker];

describe.each(engineModes)("BeaconChain serialized bytes lifecycle (beaconEngineMode=%s)", (beaconEngineMode) => {
  const block = ssz.phase0.SignedBeaconBlock.defaultValue();
  const blockRoot = ssz.phase0.BeaconBlock.hashTreeRoot(block.message);
  const blockRootHex = toRootHex(blockRoot);
  const signedRoot = toSignedBlockRootHex(computeSignedBlockRoot(ForkName.phase0, block));
  const blockBytes = ssz.phase0.SignedBeaconBlock.serialize(block);
  const blockInput = BlockInputPreData.createFromBlock({
    block,
    blockRootHex,
    forkName: ForkName.phase0,
    daOutOfRange: false,
    source: BlockInputSource.gossip,
    seenTimestampSec: 0,
  });
  const importedBlock = toChainViewBlockBytes({...zeroProtoBlock, blockRoot: blockRootHex});
  const importResult: ImportBlockResponse = {
    block: importedBlock,
    newHead: importedBlock,
    justified: {epoch: 0, root: fromHex(blockRootHex)},
    finalized: {epoch: 0, root: fromHex(blockRootHex)},
    executionOptimistic: false,
    headUpdate: null,
    reorg: null,
    justifiedCheckpointChanged: false,
    finalizedCheckpointChanged: false,
    version: 0,
  };
  let chain: ReturnType<typeof getMockedBeaconChain>;
  let engineImport: ReturnType<typeof defer<ImportBlockResponse>>;
  let sidecarWrite: ReturnType<typeof defer<void>>;
  let engineCache: BlockSerializedCache;

  beforeEach(() => {
    chain = getMockedBeaconChain();
    chain.opts.beaconEngineMode = beaconEngineMode;
    engineCache = chain.beaconEngine.blockSerializedCache;
    engineImport = defer<ImportBlockResponse>();
    sidecarWrite = defer<void>();
    chain.beaconEngine.importBlock = vi.fn().mockImplementation(async () => {
      const result = await engineImport.promise;
      engineCache.delete(signedRoot, undefined, "persisted");
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
    chain.serializedCache.set(block, blockBytes);
    engineCache.set(signedRoot, block, blockBytes);
  });

  afterEach(() => {
    sidecarWrite.resolve();
    vi.restoreAllMocks();
  });

  it("retains local bytes after engine import while sidecar writes are still pending", async () => {
    const importing = importBlock.call(withBeaconEngineFacade(chain), blockInput, DataAvailabilityStatus.PreData, {});
    await vi.waitFor(() => expect(chain.beaconEngine.importBlock).toHaveBeenCalledOnce());
    expect(chain.serializedCache.get(block)).toBeDefined();

    engineImport.resolve(importResult);
    await importing;

    expect(chain.serializedCache.get(block)).toBe(blockBytes);
    expect(engineCache.get(signedRoot)).toBeUndefined();
    expect(chain.seenBlockInputCache.prune).not.toHaveBeenCalled();
  });

  it("uses the engine's returned optimism for the block event", async () => {
    const facade = withBeaconEngineFacade(chain);
    const onBlock = vi.fn();
    facade.emitter.on(routes.events.EventType.block, onBlock);
    vi.mocked(eventLoop.callInNextEventLoop).mockImplementationOnce((callback) => callback());
    const importing = importBlock.call(facade, blockInput, DataAvailabilityStatus.PreData, {});
    engineImport.resolve({...importResult, executionOptimistic: true});
    await importing;
    expect(onBlock).toHaveBeenCalledExactlyOnceWith({block: blockRootHex, slot: 0, executionOptimistic: true});
  });

  it("retains the main-thread entry when engine import fails", async () => {
    const cached = chain.serializedCache.get(block);
    const error = new Error("Engine import failed");
    const importing = importBlock.call(withBeaconEngineFacade(chain), blockInput, DataAvailabilityStatus.PreData, {});
    const rejected = expect(importing).rejects.toBe(error);
    await vi.waitFor(() => expect(chain.beaconEngine.importBlock).toHaveBeenCalledOnce());

    engineImport.reject(error);
    await rejected;

    expect(chain.serializedCache.get(block)).toBe(cached);
    expect(engineCache.get(signedRoot)).toBeDefined();
    expect(chain.seenBlockInputCache.prune).not.toHaveBeenCalled();
  });

  it("rehydrates a cloned typed failure without applying successful-import cleanup", async () => {
    const error = new BlockError(block, {code: BlockErrorCode.ALREADY_KNOWN, root: blockRootHex});
    const roots = [computeSignedBlockRoot(ForkName.phase0, block)];
    chain.beaconEngine.importBlock = vi
      .fn()
      .mockResolvedValue(structuredClone({err: blockFailureFromError(error, chain.config, roots)}));
    const cached = chain.serializedCache.get(block);
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
    expect(chain.serializedCache.get(block)).toBe(cached);
    expect(chain.seenBlockInputCache.prune).not.toHaveBeenCalled();
  });
});
