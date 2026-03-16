import {Epoch, Root, Slot, phase0} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "../cache/stateCache.js";
import {IBeaconStateView} from "../stateView/interface.js";
import {getBlockRoot, getBlockRootAtSlot} from "./blockRoot.js";

/**
 * Typeguard to distinguish CachedBeaconStateAllForks from IBeaconStateView.
 * Uses `epochCtx` as the definitive marker of CachedBeaconStateAllForks.
 */
export function isCachedBeaconStateAllForks(
  state: CachedBeaconStateAllForks | IBeaconStateView
): state is CachedBeaconStateAllForks {
  return (state as CachedBeaconStateAllForks).epochCtx !== undefined;
}

/**
 * Cache to prevent accessing the state tree to fetch block roots repeteadly.
 * In normal network conditions the same root is read multiple times, specially the target.
 */
export class RootCache {
  readonly currentJustifiedCheckpoint: phase0.Checkpoint;
  readonly previousJustifiedCheckpoint: phase0.Checkpoint;
  private readonly blockRootEpochCache = new Map<Epoch, Root>();
  private readonly blockRootSlotCache = new Map<Slot, Root>();

  constructor(private readonly state: CachedBeaconStateAllForks | IBeaconStateView) {
    this.currentJustifiedCheckpoint = state.currentJustifiedCheckpoint;
    this.previousJustifiedCheckpoint = state.previousJustifiedCheckpoint;
  }

  getBlockRoot(epoch: Epoch): Root {
    let root = this.blockRootEpochCache.get(epoch);
    if (!root) {
      root = isCachedBeaconStateAllForks(this.state)
        ? getBlockRoot(this.state, epoch)
        : this.state.getBlockRootAtEpoch(epoch);
      this.blockRootEpochCache.set(epoch, root);
    }
    return root;
  }

  getBlockRootAtSlot(slot: Slot): Root {
    let root = this.blockRootSlotCache.get(slot);
    if (!root) {
      root = isCachedBeaconStateAllForks(this.state)
        ? getBlockRootAtSlot(this.state, slot)
        : this.state.getBlockRootAtSlot(slot);
      this.blockRootSlotCache.set(slot, root);
    }
    return root;
  }
}
