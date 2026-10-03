import {describe, expect, it, vi} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {config} from "@lodestar/config/default";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {RootHex, Slot} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {
  ExecutionStatus,
  ForkChoice,
  IForkChoiceStore,
  PayloadStatus,
  ProtoArray,
  ProtoBlock,
} from "../../../src/index.js";
import {getBlockRoot, getStateRoot} from "../../utils/index.js";

describe("fast confirmation pause/resume", () => {
  const genesisSlot = 0;
  const genesisEpoch = 0;
  const genesisRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const finalizedRoot = getBlockRoot(genesisSlot);
  const parentRoot = toHex(Buffer.alloc(32, 0xff));
  const validatorCount = 100;

  function makeProtoArr(): ProtoArray {
    return ProtoArray.initialize(
      {
        slot: genesisSlot,
        stateRoot: getStateRoot(genesisSlot),
        parentRoot,
        blockRoot: finalizedRoot,

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

  function makeFcStore(notify: (data: {block: RootHex; slot: Slot; currentSlot: Slot}) => void): IForkChoiceStore {
    const checkpoint = {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot};
    return {
      currentSlot: genesisSlot + 1,
      justified: {checkpoint, balances: new Uint16Array([32]), totalBalance: 32},
      unrealizedJustified: {checkpoint, balances: new Uint16Array([32])},
      finalizedCheckpoint: checkpoint,
      unrealizedFinalizedCheckpoint: checkpoint,
      justifiedBalancesGetter: () => new Uint16Array([32]),
      equivocatingIndices: new Set(),
      confirmedRoot: finalizedRoot,
      previousEpochObservedJustifiedCheckpoint: checkpoint,
      currentEpochObservedJustifiedCheckpoint: checkpoint,
      previousEpochGreatestUnrealizedCheckpoint: checkpoint,
      previousEpochObservedJustifiedBalances: new Uint16Array([32]),
      currentEpochObservedJustifiedBalances: new Uint16Array([32]),
      previousEpochGreatestUnrealizedBalances: new Uint16Array([32]),
      previousSlotHead: finalizedRoot,
      currentSlotHead: finalizedRoot,
      stateGetter: () => null,
      notifyFastConfirmation: notify,
    };
  }

  it("pins confirmed root to finalized and emits the event while paused", () => {
    const notify = vi.fn();
    const fcStore = makeFcStore(notify);
    const forkchoice = new ForkChoice(config, fcStore, makeProtoArr(), validatorCount, null, {
      fastConfirmation: true,
    });
    forkchoice.pauseFastConfirmation();

    // Simulate a stale confirmed root that the paused path must pin back to finalized
    fcStore.confirmedRoot = `0x${"12".repeat(32)}`;
    forkchoice.updateTime((genesisSlot + 2) as Slot);

    expect(fcStore.confirmedRoot).toBe(finalizedRoot);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith({block: finalizedRoot, slot: genesisSlot, currentSlot: genesisSlot + 2});
  });

  it("pins confirmed root to finalized and emits the event immediately on pause, before the next slot tick", () => {
    const notify = vi.fn();
    const fcStore = makeFcStore(notify);
    const forkchoice = new ForkChoice(config, fcStore, makeProtoArr(), validatorCount, null, {
      fastConfirmation: true,
    });

    fcStore.confirmedRoot = `0x${"12".repeat(32)}`;
    forkchoice.pauseFastConfirmation();

    expect(fcStore.confirmedRoot).toBe(finalizedRoot);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({block: finalizedRoot, slot: genesisSlot, currentSlot: genesisSlot + 1});
  });

  it("runs the rule again after resume", () => {
    const notify = vi.fn();
    const fcStore = makeFcStore(notify);
    const forkchoice = new ForkChoice(config, fcStore, makeProtoArr(), validatorCount, null, {
      fastConfirmation: true,
    });
    forkchoice.pauseFastConfirmation();

    forkchoice.updateTime((genesisSlot + 2) as Slot);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith({block: finalizedRoot, slot: genesisSlot, currentSlot: genesisSlot + 2});

    forkchoice.resumeFastConfirmation();
    forkchoice.updateTime((genesisSlot + 3) as Slot);
    expect(notify).toHaveBeenCalledTimes(3);
    expect(fcStore.confirmedRoot).toBe(finalizedRoot);
  });

  it("runs the rule normally when never paused", () => {
    const notify = vi.fn();
    const fcStore = makeFcStore(notify);
    const forkchoice = new ForkChoice(config, fcStore, makeProtoArr(), validatorCount, null, {
      fastConfirmation: true,
    });

    forkchoice.updateTime((genesisSlot + 2) as Slot);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
