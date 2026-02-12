import {describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {AncestorStatus, ExecutionStatus, type IForkChoice, type ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputPreData} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/index.js";
import {importBlock} from "../../../../src/chain/blocks/importBlock.js";
import {AttestationImportOpt, type FullyVerifiedBlock} from "../../../../src/chain/blocks/types.js";
import type {BeaconChain} from "../../../../src/chain/chain.js";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {ForkchoiceCaller} from "../../../../src/chain/forkChoice/index.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

/**
 * Create a minimal ProtoBlock for testing
 */
function makeProtoBlock(overrides: Partial<ProtoBlock> = {}): ProtoBlock {
  return {
    slot: 1,
    blockRoot: "0x" + "ab".repeat(32),
    parentRoot: "0x" + "00".repeat(32),
    stateRoot: "0x" + "cd".repeat(32),
    targetRoot: "0x" + "ef".repeat(32),
    justifiedEpoch: 0,
    justifiedRoot: "0x" + "00".repeat(32),
    finalizedEpoch: 0,
    finalizedRoot: "0x" + "00".repeat(32),
    unrealizedJustifiedEpoch: 0,
    unrealizedJustifiedRoot: "0x" + "00".repeat(32),
    unrealizedFinalizedEpoch: 0,
    unrealizedFinalizedRoot: "0x" + "00".repeat(32),
    executionPayloadBlockHash: null,
    executionStatus: ExecutionStatus.PreMerge,
    dataAvailabilityStatus: DataAvailabilityStatus.PreData,
    timeliness: true,
    ...overrides,
  } as ProtoBlock;
}

/**
 * Create a mock chain context that satisfies what importBlock.call() needs.
 * This avoids the heavyweight getMockedBeaconChain() with its global vi.mock() side effects.
 */
function createMockChainForImportBlock(opts: {currentSlot?: number; blockSlot?: number} = {}): {
  chain: BeaconChain;
  forkChoice: Record<string, ReturnType<typeof vi.fn>>;
  emitter: ChainEventEmitter;
  regen: Record<string, ReturnType<typeof vi.fn>>;
  executionEngine: Record<string, ReturnType<typeof vi.fn>>;
} {
  const currentSlot = opts.currentSlot ?? 1;
  const blockSlot = opts.blockSlot ?? 1;

  const emitter = new ChainEventEmitter();

  const oldHead = makeProtoBlock({
    slot: 0,
    blockRoot: "0x" + "aa".repeat(32),
    stateRoot: "0x" + "bb".repeat(32),
  });

  const forkChoice: Record<string, ReturnType<typeof vi.fn>> = {
    getTime: vi.fn().mockReturnValue(currentSlot),
    getFinalizedCheckpoint: vi
      .fn()
      .mockReturnValue({epoch: 0, root: Buffer.alloc(32), rootHex: "0x" + "00".repeat(32)}),
    onBlock: vi.fn().mockReturnValue(makeProtoBlock({slot: blockSlot})),
    onAttestation: vi.fn(),
    onAttesterSlashing: vi.fn(),
    getHead: vi.fn().mockReturnValue(oldHead),
    getCommonAncestorDepth: vi.fn().mockReturnValue({code: AncestorStatus.Descendant}),
    getDependentRoot: vi.fn().mockReturnValue("0x" + "dd".repeat(32)),
    getFinalizedBlock: vi
      .fn()
      .mockReturnValue(makeProtoBlock({executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge})),
    getJustifiedBlock: vi.fn().mockReturnValue(makeProtoBlock()),
    shouldOverrideForkChoiceUpdate: vi.fn().mockReturnValue({shouldOverrideFcu: false, reason: "Unknown"}),
    getBlock: vi.fn().mockReturnValue(null),
    updateAndGetHead: vi.fn().mockReturnValue({head: oldHead}),
  };

  const regen: Record<string, ReturnType<typeof vi.fn>> = {
    processState: vi.fn(),
    updateHeadState: vi.fn(),
    addCheckpointState: vi.fn(),
  };

  const executionEngine: Record<string, ReturnType<typeof vi.fn>> = {
    notifyForkchoiceUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const chain = {
    config,
    opts: {},
    forkChoice: forkChoice as unknown as IForkChoice,
    unfinalizedBlockWrites: {
      push: vi.fn().mockResolvedValue(undefined),
      waitForSpace: vi.fn().mockResolvedValue(undefined),
    },
    serializedCache: {clear: vi.fn()},
    checkpointBalancesCache: {processState: vi.fn()},
    regen,
    metrics: null,
    logger: getMockedLogger(),
    seenBlockAttesters: {addIndices: vi.fn()},
    seenAggregatedAttestations: {add: vi.fn()},
    validatorMonitor: null,
    emitter,
    clock: {
      secFromSlot: vi.fn().mockReturnValue(0),
      slotWithFutureTolerance: vi.fn().mockReturnValue(currentSlot),
    },
    recomputeForkChoiceHead: vi.fn().mockReturnValue(oldHead),
    onNewHead: vi.fn(),
    executionEngine,
    beaconProposerCache: {get: vi.fn().mockReturnValue(undefined)},
    shufflingCache: {processState: vi.fn()},
    reprocessController: {onBlockImported: vi.fn()},
    lightClientServer: null,
  } as unknown as BeaconChain;

  return {chain, forkChoice, emitter, regen, executionEngine};
}

/**
 * Create a FullyVerifiedBlock for testing with a phase0 block
 */
function createFullyVerifiedBlock(overrides: {blockSlot?: number; parentBlockSlot?: number} = {}): {
  fullyVerifiedBlock: FullyVerifiedBlock;
  blockRootHex: string;
} {
  const blockSlot = overrides.blockSlot ?? 1;
  const parentBlockSlot = overrides.parentBlockSlot ?? 0;
  const nowSec = 1_672_531_200; // Fixed timestamp for deterministic tests

  const block = ssz.phase0.SignedBeaconBlock.defaultValue();
  block.message.slot = blockSlot;

  const blockRootHex = toRootHex(config.getForkTypes(blockSlot).BeaconBlock.hashTreeRoot(block.message));

  const blockInput = BlockInputPreData.createFromBlock({
    block,
    blockRootHex,
    forkName: ForkName.phase0,
    daOutOfRange: true,
    source: BlockInputSource.gossip,
    seenTimestampSec: nowSec,
  });

  // Minimal mock of CachedBeaconStateAllForks with what importBlock accesses
  const postState = {
    genesisTime: nowSec - blockSlot * 12,
    slot: blockSlot,
    epochCtx: {
      getBeaconProposer: vi.fn().mockReturnValue(0),
      currentSyncCommitteeIndexed: {validatorIndices: []},
      currentShuffling: {activeIndices: []},
      getShufflingDecisionRoot: vi.fn(),
    },
    validators: {nodesPopulated: true},
    latestBlockHeader: ssz.phase0.BeaconBlockHeader.defaultValue(),
    currentJustifiedCheckpoint: {epoch: 0, root: Buffer.alloc(32)},
    previousJustifiedCheckpoint: {epoch: 0, root: Buffer.alloc(32)},
    finalizedCheckpoint: {epoch: 0, root: Buffer.alloc(32)},
    hashTreeRoot: vi.fn().mockReturnValue(Buffer.alloc(32)),
  };

  const fullyVerifiedBlock: FullyVerifiedBlock = {
    blockInput,
    postState: postState as any,
    parentBlockSlot,
    proposerBalanceDelta: 0,
    executionStatus: ExecutionStatus.PreMerge,
    dataAvailabilityStatus: DataAvailabilityStatus.PreData,
    indexedAttestations: [],
    seenTimestampSec: nowSec,
  };

  return {fullyVerifiedBlock, blockRootHex};
}

describe("chain / blocks / importBlock", () => {
  describe("happy path", () => {
    it("should import block and update head when head changes", async () => {
      const {chain, forkChoice, emitter, regen} = createMockChainForImportBlock({currentSlot: 1, blockSlot: 1});
      const {fullyVerifiedBlock, blockRootHex} = createFullyVerifiedBlock({blockSlot: 1});

      const newHead = makeProtoBlock({slot: 1, blockRoot: blockRootHex, stateRoot: "0x" + "ff".repeat(32)});
      // recomputeForkChoiceHead returns new head (different from old)
      (chain.recomputeForkChoiceHead as ReturnType<typeof vi.fn>).mockReturnValue(newHead);

      const headEvents: unknown[] = [];
      emitter.on(routes.events.EventType.head, (data) => headEvents.push(data));

      await importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip});

      // Block should be persisted to DB queue
      expect(chain.unfinalizedBlockWrites.push).toHaveBeenCalledOnce();

      // Serialized cache should be cleared
      expect(chain.serializedCache.clear).toHaveBeenCalledOnce();

      // Fork choice onBlock should be called
      expect(forkChoice.onBlock).toHaveBeenCalledOnce();

      // State should be added to regen
      expect(regen.processState).toHaveBeenCalledOnce();

      // Head should be recomputed
      expect(chain.recomputeForkChoiceHead).toHaveBeenCalledWith(ForkchoiceCaller.importBlock);

      // Since head changed, regen.updateHeadState should be called
      expect(regen.updateHeadState).toHaveBeenCalledWith(newHead, fullyVerifiedBlock.postState);

      // Head event should be emitted
      expect(headEvents).toHaveLength(1);
      expect(headEvents[0]).toMatchObject({
        block: newHead.blockRoot,
        slot: newHead.slot,
        state: newHead.stateRoot,
      });
    });

    it("should push block to unfinalizedBlockWrites even before fork-choice import", async () => {
      const {chain, forkChoice} = createMockChainForImportBlock();
      const {fullyVerifiedBlock} = createFullyVerifiedBlock();

      // Track call order
      const callOrder: string[] = [];
      (chain.unfinalizedBlockWrites.push as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callOrder.push("dbWrite");
        return Promise.resolve();
      });
      forkChoice.onBlock.mockImplementation(() => {
        callOrder.push("onBlock");
        return makeProtoBlock();
      });

      await importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip});

      // DB write must happen before fork-choice onBlock
      expect(callOrder.indexOf("dbWrite")).toBeLessThan(callOrder.indexOf("onBlock"));
    });
  });

  describe("head unchanged - no events", () => {
    it("should not emit head or reorg events when head does not change", async () => {
      const {chain, emitter, regen} = createMockChainForImportBlock();
      const {fullyVerifiedBlock} = createFullyVerifiedBlock();

      // recomputeForkChoiceHead returns same old head
      const oldHead = makeProtoBlock({slot: 0, blockRoot: "0x" + "aa".repeat(32)});
      (chain.recomputeForkChoiceHead as ReturnType<typeof vi.fn>).mockReturnValue(oldHead);

      const headEvents: unknown[] = [];
      const reorgEvents: unknown[] = [];
      emitter.on(routes.events.EventType.head, (data) => headEvents.push(data));
      emitter.on(routes.events.EventType.chainReorg, (data) => reorgEvents.push(data));

      await importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip});

      // No head event since head didn't change
      expect(headEvents).toHaveLength(0);
      // No reorg event
      expect(reorgEvents).toHaveLength(0);
      // regen.updateHeadState should NOT be called when head unchanged
      expect(regen.updateHeadState).not.toHaveBeenCalled();
    });
  });

  describe("reorg scenarios", () => {
    it("should emit chainReorg event when getCommonAncestorDepth returns CommonAncestor", async () => {
      const {chain, forkChoice, emitter} = createMockChainForImportBlock();
      const {fullyVerifiedBlock, blockRootHex} = createFullyVerifiedBlock();

      const newHead = makeProtoBlock({slot: 1, blockRoot: blockRootHex, stateRoot: "0x" + "ff".repeat(32)});
      (chain.recomputeForkChoiceHead as ReturnType<typeof vi.fn>).mockReturnValue(newHead);

      // Indicate a reorg: old head and new head share a common ancestor
      const reorgDepth = 3;
      forkChoice.getCommonAncestorDepth.mockReturnValue({code: AncestorStatus.CommonAncestor, depth: reorgDepth});

      const reorgEvents: unknown[] = [];
      emitter.on(routes.events.EventType.chainReorg, (data) => reorgEvents.push(data));

      await importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip});

      expect(reorgEvents).toHaveLength(1);
      expect(reorgEvents[0]).toMatchObject({
        depth: reorgDepth,
        slot: newHead.slot,
        newHeadBlock: newHead.blockRoot,
        oldHeadBlock: "0x" + "aa".repeat(32),
      });
    });

    it("should NOT emit chainReorg event when ancestor result is Descendant (no reorg)", async () => {
      const {chain, forkChoice, emitter} = createMockChainForImportBlock();
      const {fullyVerifiedBlock, blockRootHex} = createFullyVerifiedBlock();

      const newHead = makeProtoBlock({slot: 1, blockRoot: blockRootHex});
      (chain.recomputeForkChoiceHead as ReturnType<typeof vi.fn>).mockReturnValue(newHead);

      // Descendant = new head is a direct descendant of old head, no reorg
      forkChoice.getCommonAncestorDepth.mockReturnValue({code: AncestorStatus.Descendant});

      const reorgEvents: unknown[] = [];
      emitter.on(routes.events.EventType.chainReorg, (data) => reorgEvents.push(data));

      await importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip});

      expect(reorgEvents).toHaveLength(0);
    });
  });

  describe("error paths", () => {
    it("should propagate error when forkChoice.onBlock throws", async () => {
      const {chain, forkChoice} = createMockChainForImportBlock();
      const {fullyVerifiedBlock} = createFullyVerifiedBlock();

      const error = new Error("onBlock failed");
      forkChoice.onBlock.mockImplementation(() => {
        throw error;
      });

      await expect(
        importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip})
      ).rejects.toThrow("onBlock failed");
    });

    it("should still import block even if getDependentRoot throws during head event emission", async () => {
      const {chain, forkChoice} = createMockChainForImportBlock();
      const {fullyVerifiedBlock, blockRootHex} = createFullyVerifiedBlock();

      const newHead = makeProtoBlock({slot: 1, blockRoot: blockRootHex});
      (chain.recomputeForkChoiceHead as ReturnType<typeof vi.fn>).mockReturnValue(newHead);

      // getDependentRoot throws (as seen in holesky non-finality issue)
      forkChoice.getDependentRoot.mockImplementation(() => {
        throw new Error("No block for root");
      });

      // Should not reject - the error is caught internally
      await expect(
        importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip})
      ).resolves.toBeUndefined();

      // onBlock should still have been called
      expect(forkChoice.onBlock).toHaveBeenCalled();
    });

    it("should not reject when notifyForkchoiceUpdate fails", async () => {
      const currentSlot = 1;
      const {chain, forkChoice, executionEngine} = createMockChainForImportBlock({currentSlot});
      const {fullyVerifiedBlock, blockRootHex} = createFullyVerifiedBlock({blockSlot: currentSlot});

      // Set up execution-enabled state so FCU is attempted
      const newHead = makeProtoBlock({
        slot: currentSlot,
        blockRoot: blockRootHex,
        executionPayloadBlockHash: "0x" + "ee".repeat(32),
        executionStatus: ExecutionStatus.Valid,
        executionPayloadNumber: 1,
        dataAvailabilityStatus: DataAvailabilityStatus.PreData,
      });
      (chain.recomputeForkChoiceHead as ReturnType<typeof vi.fn>).mockReturnValue(newHead);
      forkChoice.getHead.mockReturnValue(newHead);
      forkChoice.getJustifiedBlock.mockReturnValue(newHead);
      forkChoice.getFinalizedBlock.mockReturnValue(newHead);

      // FCU rejects
      executionEngine.notifyForkchoiceUpdate.mockRejectedValue(new Error("EL unavailable"));

      // importBlock should NOT reject even though FCU fails
      await expect(
        importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip})
      ).resolves.toBeUndefined();
    });
  });

  describe("fork-choice update notification", () => {
    it("should NOT call notifyForkchoiceUpdate when head and finalized unchanged", async () => {
      const {chain, executionEngine} = createMockChainForImportBlock();
      const {fullyVerifiedBlock} = createFullyVerifiedBlock();

      // Head unchanged (recomputeForkChoiceHead returns same old head)
      await importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip});

      expect(executionEngine.notifyForkchoiceUpdate).not.toHaveBeenCalled();
    });

    it("should NOT call notifyForkchoiceUpdate when disableImportExecutionFcU is true", async () => {
      const {chain, forkChoice, executionEngine} = createMockChainForImportBlock({currentSlot: 1});
      const {fullyVerifiedBlock, blockRootHex} = createFullyVerifiedBlock({blockSlot: 1});

      (chain as any).opts = {disableImportExecutionFcU: true};
      // Use an execution-enabled head so the test actually validates the option
      // (without this, FCU would be skipped due to zero block hash anyway)
      const newHead = makeProtoBlock({
        slot: 1,
        blockRoot: blockRootHex,
        executionPayloadBlockHash: "0x" + "ee".repeat(32),
        executionStatus: ExecutionStatus.Valid,
        executionPayloadNumber: 1,
        dataAvailabilityStatus: DataAvailabilityStatus.PreData,
      });
      (chain.recomputeForkChoiceHead as ReturnType<typeof vi.fn>).mockReturnValue(newHead);
      forkChoice.getHead.mockReturnValue(newHead);
      forkChoice.getFinalizedBlock.mockReturnValue(newHead);
      forkChoice.getJustifiedBlock.mockReturnValue(newHead);

      await importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip});

      expect(executionEngine.notifyForkchoiceUpdate).not.toHaveBeenCalled();
    });
  });

  describe("checkpoint and epoch boundary", () => {
    it("should process shuffling cache when crossing epoch boundary", async () => {
      // Block at slot 32 (epoch 1), parent at slot 31 (epoch 0)
      const blockSlot = SLOTS_PER_EPOCH;
      const parentBlockSlot = SLOTS_PER_EPOCH - 1;
      const {chain} = createMockChainForImportBlock({currentSlot: blockSlot, blockSlot});
      const {fullyVerifiedBlock} = createFullyVerifiedBlock({blockSlot, parentBlockSlot});

      await importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip});

      expect(chain.shufflingCache.processState).toHaveBeenCalledWith(fullyVerifiedBlock.postState);
    });

    it("should NOT process shuffling cache when parent and block are same epoch", async () => {
      const blockSlot = 5;
      const parentBlockSlot = 4;
      const {chain} = createMockChainForImportBlock({currentSlot: blockSlot, blockSlot});
      const {fullyVerifiedBlock} = createFullyVerifiedBlock({blockSlot, parentBlockSlot});

      await importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip});

      expect(chain.shufflingCache.processState).not.toHaveBeenCalled();
    });

    it("should emit checkpoint event at epoch boundary slot", async () => {
      const blockSlot = SLOTS_PER_EPOCH; // slot 32 = first slot of epoch 1
      const {chain, emitter} = createMockChainForImportBlock({currentSlot: blockSlot, blockSlot});
      const {fullyVerifiedBlock} = createFullyVerifiedBlock({blockSlot, parentBlockSlot: blockSlot - 1});

      const checkpointEvents: unknown[] = [];
      emitter.on(ChainEvent.checkpoint, (...args) => checkpointEvents.push(args));

      await importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip});

      expect(checkpointEvents).toHaveLength(1);
    });

    it("should NOT emit checkpoint event at non-boundary slot", async () => {
      const blockSlot = 5;
      const {chain, emitter} = createMockChainForImportBlock({currentSlot: blockSlot, blockSlot});
      const {fullyVerifiedBlock} = createFullyVerifiedBlock({blockSlot, parentBlockSlot: 4});

      const checkpointEvents: unknown[] = [];
      emitter.on(ChainEvent.checkpoint, (...args) => checkpointEvents.push(args));

      await importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip});

      expect(checkpointEvents).toHaveLength(0);
    });
  });

  describe("attestation processing", () => {
    it("should skip attestation processing when importAttestations is Skip", async () => {
      const {chain, forkChoice} = createMockChainForImportBlock();
      const {fullyVerifiedBlock} = createFullyVerifiedBlock();

      await importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip});

      expect(forkChoice.onAttestation).not.toHaveBeenCalled();
    });

    it("should skip attestation processing when block epoch is too old", async () => {
      // Block at epoch 0, current slot is far in the future (epoch 5)
      const currentSlot = 5 * SLOTS_PER_EPOCH;
      const blockSlot = 1;
      const {chain, forkChoice} = createMockChainForImportBlock({currentSlot, blockSlot});
      const {fullyVerifiedBlock} = createFullyVerifiedBlock({blockSlot});

      await importBlock.call(chain, fullyVerifiedBlock, {});

      // Block is too old for attestation import (epoch 0 < currentEpoch - 1)
      expect(forkChoice.onAttestation).not.toHaveBeenCalled();
    });
  });

  describe("reprocess controller", () => {
    it("should trigger reprocessController.onBlockImported via callInNextEventLoop", async () => {
      const {chain} = createMockChainForImportBlock();
      const {fullyVerifiedBlock, blockRootHex} = createFullyVerifiedBlock();

      await importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip});

      // callInNextEventLoop schedules with setTimeout(fn, 0), so flush microtasks
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(chain.reprocessController.onBlockImported).toHaveBeenCalledWith(
        {slot: 1, root: blockRootHex},
        expect.any(Number)
      );
    });
  });

  describe("block unavailable check", () => {
    it("should throw if blockInput does not have all data", async () => {
      const {chain} = createMockChainForImportBlock();
      const {fullyVerifiedBlock} = createFullyVerifiedBlock();

      // Override blockInput.hasAllData to return false
      Object.defineProperty(fullyVerifiedBlock.blockInput, "hasAllData", {
        get: () => false,
      });

      await expect(
        importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip})
      ).rejects.toThrow("Unavailable block can not be imported in forkchoice");
    });
  });
});
