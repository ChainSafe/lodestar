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
 * Finality advances on every `on_block` and `on_tick`, the rule only runs on the slot tick. These cover the
 * window in between: the confirmed root must never point outside the finalized subtree, otherwise every safe
 * block lookup throws `MISSING_PROTO_ARRAY_BLOCK` until the next tick.
 */
describe("fast confirmation on finalization", () => {
  const genesisSlot = 0;
  const genesisEpoch = 0;
  const genesisRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const anchorRoot = getBlockRoot(genesisSlot);
  const parentRoot = toHex(Buffer.alloc(32, 0xff));
  const validatorCount = 100;

  // A chain with a block on each of the first three epoch boundaries, plus one block right after the last
  const epoch1Slot = SLOTS_PER_EPOCH;
  const epoch2Slot = 2 * SLOTS_PER_EPOCH;
  const chainSlots = [epoch1Slot, epoch2Slot, epoch2Slot + 1];
  const parentSlotBySlot = new Map<Slot, Slot>([
    [epoch1Slot, genesisSlot],
    [epoch2Slot, epoch1Slot],
    [epoch2Slot + 1, epoch2Slot],
  ]);

  function makeProtoArr(): ProtoArray {
    return ProtoArray.initialize(
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
  }

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

  function toCheckpoint(epoch: number, rootHex: RootHex): CheckpointWithHex {
    return {epoch, root: fromHexString(rootHex), rootHex};
  }

  /**
   * `confirmedRootOnFinalized` records what the confirmed root was at the moment the finalized checkpoint
   * moved, which is what `onFinalized` listeners and any import in that window observe.
   */
  function setup(confirmedRoot: RootHex): {
    forkchoice: ForkChoice;
    fcStore: IForkChoiceStore;
    confirmedRootOnFinalized: () => RootHex | null;
  } {
    const checkpoint = toCheckpoint(genesisEpoch, anchorRoot);
    const balances = new Uint16Array([32]);
    let confirmedRootOnFinalized: RootHex | null = null;
    let finalizedCheckpoint = checkpoint;

    const fcStore = {
      currentSlot: epoch2Slot - 1,
      justified: {checkpoint, balances, totalBalance: 32},
      unrealizedJustified: {checkpoint, balances},
      get finalizedCheckpoint(): CheckpointWithHex {
        return finalizedCheckpoint;
      },
      set finalizedCheckpoint(cp: CheckpointWithHex) {
        confirmedRootOnFinalized = fcStore.confirmedRoot;
        finalizedCheckpoint = cp;
      },
      unrealizedFinalizedCheckpoint: toCheckpoint(2, getBlockRoot(epoch2Slot)),
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
      notifyFastConfirmation: vi.fn(),
    } as unknown as IForkChoiceStore;

    const protoArr = makeProtoArr();
    for (const slot of chainSlots) {
      protoArr.onBlock(makeChainBlock(slot), slot, null);
    }

    const forkchoice = new ForkChoice(config, fcStore, protoArr, validatorCount, null, {fastConfirmation: true});
    // Same state as a syncing node: the rule is paused and only re-pins on the slot tick
    forkchoice.pauseFastConfirmation();
    // After pausing, which pins the root to the finalized checkpoint of the moment
    fcStore.confirmedRoot = confirmedRoot;

    return {forkchoice, fcStore, confirmedRootOnFinalized: () => confirmedRootOnFinalized};
  }

  it("pins the confirmed root to finalized when finality advances past it, before any pruning", () => {
    // Confirmed root is a block from the epoch that just got finalized away, it is still in protoArray
    const {forkchoice, fcStore, confirmedRootOnFinalized} = setup(getBlockRoot(epoch1Slot));

    forkchoice.updateTime(epoch2Slot);

    expect(fcStore.finalizedCheckpoint.rootHex).toBe(getBlockRoot(epoch2Slot));
    expect(confirmedRootOnFinalized()).toBe(getBlockRoot(epoch2Slot));
    expect(forkchoice.getConfirmedBlock()?.blockRoot).toBe(getBlockRoot(epoch2Slot));
  });

  it("leaves a confirmed root that is a descendant of the new finalized checkpoint alone", () => {
    const {forkchoice, confirmedRootOnFinalized} = setup(getBlockRoot(epoch2Slot + 1));

    forkchoice.updateTime(epoch2Slot);

    expect(confirmedRootOnFinalized()).toBe(getBlockRoot(epoch2Slot + 1));
  });
});
