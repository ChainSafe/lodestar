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
 * While paused the confirmed root tracks finality, but finality advances on every `on_block` and `on_tick`
 * while the rule only re-pins on the slot tick. These cover the window in between, where the confirmed root
 * would otherwise point outside the finalized subtree and read as `null` from `getBlockHex()`.
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
   * The pin notifies, so `notify` is the visible signal that the confirmed root moved. A tick that pins on
   * the finality advance notifies once for that and again for whatever moves the root afterwards.
   */
  function setup(
    confirmedRoot: RootHex,
    paused: boolean
  ): {
    forkchoice: ForkChoice;
    fcStore: IForkChoiceStore;
    notify: ReturnType<typeof vi.fn>;
  } {
    const checkpoint = toCheckpoint(genesisEpoch, anchorRoot);
    const balances = new Uint16Array([32]);
    const notify = vi.fn();
    let finalizedCheckpoint = checkpoint;

    const fcStore = {
      currentSlot: epoch2Slot - 1,
      justified: {checkpoint, balances, totalBalance: 32},
      unrealizedJustified: {checkpoint, balances},
      get finalizedCheckpoint(): CheckpointWithHex {
        return finalizedCheckpoint;
      },
      set finalizedCheckpoint(cp: CheckpointWithHex) {
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
      notifyFastConfirmation: notify,
    } as unknown as IForkChoiceStore;

    const protoArr = makeProtoArr();
    for (const slot of chainSlots) {
      protoArr.onBlock(makeChainBlock(slot), slot, null);
    }

    const forkchoice = new ForkChoice(config, fcStore, protoArr, validatorCount, null, {fastConfirmation: true});
    if (paused) forkchoice.pauseFastConfirmation();
    // Set after pausing, which pins the root to the finalized checkpoint of the moment
    fcStore.confirmedRoot = confirmedRoot;
    notify.mockClear();

    return {forkchoice, fcStore, notify};
  }

  it("re-pins the confirmed root while paused as soon as finality moves, not only on the slot tick", () => {
    // Confirmed root is a block from the epoch that finality is about to move past, still in protoArray
    const {forkchoice, fcStore, notify} = setup(getBlockRoot(epoch1Slot), true);

    forkchoice.updateTime(epoch2Slot);

    // Two pins for this tick: one when finality advanced inside on_tick, one from the paused rule branch
    // after it. Without the first, the confirmed root is unresolvable for the whole window between them
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[0][0]).toEqual({
      block: getBlockRoot(epoch2Slot),
      slot: epoch2Slot,
      currentSlot: epoch2Slot,
    });
    expect(fcStore.finalizedCheckpoint.rootHex).toBe(getBlockRoot(epoch2Slot));
    expect(forkchoice.getConfirmedBlock()?.blockRoot).toBe(getBlockRoot(epoch2Slot));
  });

  it("leaves the confirmed root to the rule when it is running", () => {
    const {forkchoice, notify} = setup(getBlockRoot(epoch1Slot), false);

    forkchoice.updateTime(epoch2Slot);

    // A running rule owns the confirmed root, finality moving must not rewrite it out from under the spec
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
