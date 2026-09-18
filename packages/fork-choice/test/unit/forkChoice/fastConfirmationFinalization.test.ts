import {describe, expect, it, vi} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {RootHex, Slot} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {CheckpointWithHex} from "../../../src/forkChoice/store.js";
import {
  ExecutionStatus,
  ForkChoice,
  IForkChoiceStore,
  PayloadStatus,
  ProtoArray,
  ProtoBlock,
} from "../../../src/index.js";
import {getBlockRoot, getStateRoot} from "../../utils/index.js";

/**
 * The rule moves the confirmed root on the slot tick, finality advances on every `on_block`. Once finality
 * passes the confirmed root it drops out of the finalized subtree and `getBlockHex()` reads it as `null`,
 * which is what `updateHead()` has to repair, well before the archiver prunes anything.
 */
describe("fast confirmation on finalization", () => {
  const genesisSlot = 0;
  const genesisEpoch = 0;
  const genesisRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const anchorRoot = getBlockRoot(genesisSlot);
  const parentRoot = toHex(Buffer.alloc(32, 0xff));
  const validatorCount = 100;

  // A block on each of the first two epoch boundaries, plus one right after the last
  const epoch1Slot = SLOTS_PER_EPOCH;
  const epoch2Slot = 2 * SLOTS_PER_EPOCH;
  const parentSlotBySlot = new Map<Slot, Slot>([
    [epoch1Slot, genesisSlot],
    [epoch2Slot, epoch1Slot],
    [epoch2Slot + 1, epoch2Slot],
  ]);

  function makeChainBlock(slot: Slot): ProtoBlock {
    return {
      slot,
      stateRoot: getStateRoot(slot),
      parentRoot: getBlockRoot(parentSlotBySlot.get(slot) as Slot),
      blockRoot: getBlockRoot(slot),
      targetRoot: anchorRoot,

      justifiedEpoch: genesisEpoch,
      justifiedRoot: genesisRoot,
      finalizedEpoch: genesisEpoch,
      finalizedRoot: genesisRoot,
      unrealizedJustifiedEpoch: genesisEpoch,
      unrealizedJustifiedRoot: genesisRoot,
      unrealizedFinalizedEpoch: genesisEpoch,
      unrealizedFinalizedRoot: genesisRoot,

      executionPayloadBlockHash: null,
      executionStatus: ExecutionStatus.PreMerge,
      dataAvailabilityStatus: DataAvailabilityStatus.PreData,

      parentBlockHash: null,
      payloadStatus: PayloadStatus.FULL,
      timeliness: false,
      importedTimely: false,
    } as ProtoBlock;
  }

  function setup(confirmedRoot: RootHex): {
    forkchoice: ForkChoice;
    fcStore: IForkChoiceStore;
    notify: ReturnType<typeof vi.fn>;
  } {
    const checkpoint: CheckpointWithHex = {
      epoch: genesisEpoch,
      root: fromHexString(anchorRoot),
      rootHex: anchorRoot,
    };
    const balances = new Uint16Array([32]);
    const notify = vi.fn();

    const fcStore = {
      currentSlot: epoch2Slot,
      justified: {checkpoint, balances, totalBalance: 32},
      unrealizedJustified: {checkpoint, balances},
      finalizedCheckpoint: checkpoint,
      unrealizedFinalizedCheckpoint: checkpoint,
      justifiedBalancesGetter: () => balances,
      equivocatingIndices: new Set(),
      confirmedRoot: anchorRoot,
      previousEpochObservedJustifiedCheckpoint: checkpoint,
      currentEpochObservedJustifiedCheckpoint: checkpoint,
      previousEpochGreatestUnrealizedCheckpoint: checkpoint,
      previousEpochObservedJustifiedBalances: balances,
      currentEpochObservedJustifiedBalances: balances,
      previousEpochGreatestUnrealizedBalances: balances,
      previousSlotHead: anchorRoot,
      currentSlotHead: anchorRoot,
      stateGetter: () => null,
      notifyFastConfirmation: notify,
    } as unknown as IForkChoiceStore;

    const protoArr = ProtoArray.initialize(
      {
        slot: genesisSlot,
        stateRoot: getStateRoot(genesisSlot),
        parentRoot,
        blockRoot: anchorRoot,

        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
        unrealizedJustifiedEpoch: genesisEpoch,
        unrealizedJustifiedRoot: genesisRoot,
        unrealizedFinalizedEpoch: genesisEpoch,
        unrealizedFinalizedRoot: genesisRoot,

        executionPayloadBlockHash: null,
        executionStatus: ExecutionStatus.PreMerge,
        dataAvailabilityStatus: DataAvailabilityStatus.PreData,

        parentBlockHash: null,
        payloadStatus: PayloadStatus.FULL,
        timeliness: false,
        importedTimely: false,
      } as Omit<ProtoBlock, "targetRoot">,
      genesisSlot
    );
    for (const slot of [epoch1Slot, epoch2Slot, epoch2Slot + 1]) {
      protoArr.onBlock(makeChainBlock(slot), slot, null);
    }

    const forkchoice = new ForkChoice(config, fcStore, protoArr, validatorCount, null, {fastConfirmation: true});
    fcStore.confirmedRoot = confirmedRoot;
    notify.mockClear();

    // on_block advanced finality past the epoch the confirmed root sits in, nothing pruned yet
    fcStore.finalizedCheckpoint = {
      epoch: 2,
      root: fromHexString(getBlockRoot(epoch2Slot)),
      rootHex: getBlockRoot(epoch2Slot),
    };

    return {forkchoice, fcStore, notify};
  }

  it("re-pins the confirmed root that finality moved past", () => {
    const {forkchoice, fcStore, notify} = setup(getBlockRoot(epoch1Slot));

    // What importBlock does right after on_block, via recomputeForkChoiceHead()
    forkchoice.updateHead();

    expect(fcStore.confirmedRoot).toBe(getBlockRoot(epoch2Slot));
    expect(forkchoice.getConfirmedBlock()?.blockRoot).toBe(getBlockRoot(epoch2Slot));
    expect(notify).toHaveBeenCalledExactlyOnceWith({
      block: getBlockRoot(epoch2Slot),
      slot: epoch2Slot,
      currentSlot: epoch2Slot,
    });
  });

  it("leaves a confirmed root that finality has not passed alone", () => {
    const {forkchoice, fcStore, notify} = setup(getBlockRoot(epoch2Slot + 1));

    forkchoice.updateHead();

    expect(fcStore.confirmedRoot).toBe(getBlockRoot(epoch2Slot + 1));
    expect(notify).not.toHaveBeenCalled();
  });

  it("leaves an unknown confirmed root for the caller to surface", () => {
    const unknownRoot = `0x${"12".repeat(32)}`;
    const {forkchoice, fcStore, notify} = setup(unknownRoot);

    forkchoice.updateHead();

    expect(fcStore.confirmedRoot).toBe(unknownRoot);
    expect(forkchoice.getConfirmedBlock()).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });
});
