import {ForkName, GENESIS_EPOCH, GENESIS_SLOT} from "@lodestar/params";
import {Epoch, Root, Slot, phase0} from "@lodestar/types";
import {IBeaconStateView} from "../stateView/interface.js";
import {computeStartSlotAtEpoch} from "./epoch.js";

/**
 * Cache to prevent accessing the state tree to fetch block roots repeteadly.
 * In normal network conditions the same root is read multiple times, specially the target.
 */
export class RootCache {
  readonly currentJustifiedCheckpoint: phase0.Checkpoint;
  readonly previousJustifiedCheckpoint: phase0.Checkpoint;
  private readonly blockRootEpochCache = new Map<Epoch, Root>();
  private readonly blockRootSlotCache = new Map<Slot, Root>();
  private readonly checkpointRootEpochCache = new Map<Epoch, Root>();
  private readonly checkpointBoundaryForkEpoch: Epoch;

  constructor(private readonly state: IBeaconStateView) {
    this.currentJustifiedCheckpoint = state.currentJustifiedCheckpoint;
    this.previousJustifiedCheckpoint = state.previousJustifiedCheckpoint;
    this.checkpointBoundaryForkEpoch = state.forkName === ForkName.gloas ? state.fork.epoch : Infinity;
  }

  getBlockRoot(epoch: Epoch): Root {
    let root = this.blockRootEpochCache.get(epoch);
    if (!root) {
      root = this.state.getBlockRootAtEpoch(epoch);
      this.blockRootEpochCache.set(epoch, root);
    }
    return root;
  }

  getBlockRootAtSlot(slot: Slot): Root {
    let root = this.blockRootSlotCache.get(slot);
    if (!root) {
      root = this.state.getBlockRootAtSlot(slot);
      this.blockRootSlotCache.set(slot, root);
    }
    return root;
  }

  getCheckpointRoot(epoch: Epoch): Root {
    let root = this.checkpointRootEpochCache.get(epoch);
    if (!root) {
      root = this.state.getBlockRootAtSlot(
        computeCheckpointSlotAtEpochFromActivation(epoch, this.checkpointBoundaryForkEpoch)
      );
      this.checkpointRootEpochCache.set(epoch, root);
    }
    return root;
  }
}

export function computeCheckpointSlotAtEpochFromActivation(epoch: Epoch, activationEpoch: Epoch): Slot {
  if (epoch === GENESIS_EPOCH) {
    return GENESIS_SLOT;
  }

  return epoch >= activationEpoch ? computeStartSlotAtEpoch(epoch) - 1 : computeStartSlotAtEpoch(epoch);
}
