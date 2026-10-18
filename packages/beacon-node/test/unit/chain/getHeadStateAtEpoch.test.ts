import {describe, expect, it, vi} from "vitest";
import {ProtoBlock} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {IBeaconStateView} from "@lodestar/state-transition";
import {BeaconChain} from "../../../src/chain/chain.js";
import {RegenCaller} from "../../../src/chain/regen/interface.js";
import {generateProtoBlock} from "../../utils/typeGenerator.js";

describe("BeaconChain getHeadStateAtEpoch", () => {
  // epoch 2 spans slots 64..95, epoch 3 starts at slot 96
  const epoch = 2;
  const startSlot = epoch * SLOTS_PER_EPOCH;
  const lastSlot = startSlot + SLOTS_PER_EPOCH - 1;
  const nextStartSlot = startSlot + SLOTS_PER_EPOCH;

  // getHeadStateAtEpoch only reads .slot and returns the state object itself,
  // so a slot-only stand-in keeps these tests light
  function stateAt(slot: number): IBeaconStateView {
    return {slot} as unknown as IBeaconStateView;
  }

  function setup({
    head,
    closestState,
    blockState = null,
    closestBlock = null,
    regenState = stateAt(lastSlot),
  }: {
    head: ProtoBlock;
    closestState: IBeaconStateView;
    blockState?: IBeaconStateView | null;
    closestBlock?: ProtoBlock | null;
    regenState?: IBeaconStateView;
  }) {
    const chain = {
      forkChoice: {
        getHead: vi.fn().mockReturnValue(head),
        getCanonicalBlockClosestLteSlot: vi.fn().mockReturnValue(closestBlock),
      },
      regen: {
        getClosestHeadState: vi.fn().mockReturnValue(closestState),
        getStateSync: vi.fn().mockReturnValue(blockState),
        getBlockSlotState: vi.fn().mockResolvedValue(regenState),
      },
      getHeadState(): IBeaconStateView {
        return BeaconChain.prototype.getHeadState.call(this as unknown as BeaconChain);
      },
    };

    const getHeadStateAtEpoch = (e: number) =>
      BeaconChain.prototype.getHeadStateAtEpoch.call(
        chain as unknown as BeaconChain,
        e,
        RegenCaller.produceAttestationData
      );
    return {chain, getHeadStateAtEpoch, regenState};
  }

  it("returns the closest head state when it is in the requested epoch", async () => {
    const headState = stateAt(startSlot + 6);
    const head = generateProtoBlock({slot: startSlot + 6});
    const {chain, getHeadStateAtEpoch} = setup({head, closestState: headState});

    await expect(getHeadStateAtEpoch(epoch)).resolves.toBe(headState);
    expect(chain.regen.getBlockSlotState).not.toHaveBeenCalled();
    expect(chain.regen.getStateSync).not.toHaveBeenCalled();
  });

  it("regens to the start slot when the requested epoch is ahead of the head state", async () => {
    const headState = stateAt(startSlot + 6);
    const head = generateProtoBlock({slot: startSlot + 6});
    const {chain, getHeadStateAtEpoch, regenState} = setup({head, closestState: headState});

    await expect(getHeadStateAtEpoch(epoch + 1)).resolves.toBe(regenState);
    expect(chain.regen.getBlockSlotState).toHaveBeenCalledWith(
      head,
      nextStartSlot,
      {dontTransferCache: true},
      RegenCaller.produceAttestationData
    );
  });

  it("does not hand out the epoch-transition precompute when the requested epoch is behind it", async () => {
    // PrepareNextSlotScheduler precomputes the epoch transition in the last slot of
    // epoch 2, so the checkpoint state cache's closest head state is already the
    // first slot of epoch 3 while the head block is still the last slot of epoch 2.
    const precomputedState = stateAt(nextStartSlot);
    const blockState = stateAt(lastSlot);
    const head = generateProtoBlock({slot: lastSlot});
    const {chain, getHeadStateAtEpoch} = setup({head, closestState: precomputedState, blockState});

    await expect(getHeadStateAtEpoch(epoch)).resolves.toBe(blockState);
    expect(chain.regen.getStateSync).toHaveBeenCalledWith(head.stateRoot);
    expect(chain.regen.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("regens the head block state when the precompute is ahead and the block state is not cached", async () => {
    const precomputedState = stateAt(nextStartSlot);
    const head = generateProtoBlock({slot: lastSlot});
    const {chain, getHeadStateAtEpoch, regenState} = setup({head, closestState: precomputedState, blockState: null});

    await expect(getHeadStateAtEpoch(epoch)).resolves.toBe(regenState);
    expect(chain.regen.getBlockSlotState).toHaveBeenCalledWith(
      head,
      lastSlot,
      {dontTransferCache: true},
      RegenCaller.produceAttestationData
    );
  });

  it("regens from the closest canonical block when the head block is already past the requested epoch", async () => {
    const headState = stateAt(nextStartSlot + 4);
    const head = generateProtoBlock({slot: nextStartSlot + 4});
    const closestBlock = generateProtoBlock({slot: lastSlot});
    const {chain, getHeadStateAtEpoch, regenState} = setup({head, closestState: headState, closestBlock});

    await expect(getHeadStateAtEpoch(epoch)).resolves.toBe(regenState);
    expect(chain.forkChoice.getCanonicalBlockClosestLteSlot).toHaveBeenCalledWith(lastSlot);
    expect(chain.regen.getBlockSlotState).toHaveBeenCalledWith(
      closestBlock,
      lastSlot,
      {dontTransferCache: true},
      RegenCaller.produceAttestationData
    );
  });
});
