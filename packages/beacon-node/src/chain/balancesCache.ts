import {
  CachedBeaconStateAllForks,
  computeStartSlotAtEpoch,
  EffectiveBalanceIncrements,
  getBlockRootAtSlot,
  getEffectiveBalanceIncrementsZeroInactive,
} from "@lodestar/state-transition";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {Epoch, RootHex} from "@lodestar/types";
import {toHexString} from "@lodestar/utils";

/**
 * Cache EffectiveBalanceIncrements of checkpoint blocks
 */
export class CheckpointBalancesCache {
  private readonly balancesByRootByEpoch = new Map<Epoch, Map<RootHex, EffectiveBalanceIncrements>>();

  /**
   * Inspect the given `state` and determine the root of the block at the first slot of
   * `state.current_epoch`. If there is not already some entry for the given block root, then
   * add the effective balances from the `state` to the cache.
   */
  processState(blockRootHex: RootHex, state: CachedBeaconStateAllForks): void {
    const epoch = state.epochCtx.currentShuffling.epoch;
    const epochBoundarySlot = computeStartSlotAtEpoch(epoch);
    const epochBoundaryRoot =
      epochBoundarySlot === state.slot ? blockRootHex : toHexString(getBlockRootAtSlot(state, epochBoundarySlot));

    if (this.balancesByRootByEpoch.get(epoch)?.get(epochBoundaryRoot) === undefined) {
      // expect to reach this once per epoch
      let balancesByRoot = this.balancesByRootByEpoch.get(epoch);
      if (balancesByRoot === undefined) {
        balancesByRoot = new Map<RootHex, EffectiveBalanceIncrements>();
        this.balancesByRootByEpoch.set(epoch, balancesByRoot);
        balancesByRoot.set(epochBoundaryRoot, getEffectiveBalanceIncrementsZeroInactive(state));
      }
    }
  }

  get(checkpoint: CheckpointWithHex): EffectiveBalanceIncrements | undefined {
    const {rootHex, epoch} = checkpoint;
    return this.balancesByRootByEpoch.get(epoch)?.get(rootHex);
  }

  /** Prune is called per finalized checkpoint */
  prune(finalizedEpoch: Epoch): void {
    for (const epoch of this.balancesByRootByEpoch.keys()) {
      if (epoch < finalizedEpoch) {
        this.balancesByRootByEpoch.delete(epoch);
      } else {
        break;
      }
    }
  }
}
