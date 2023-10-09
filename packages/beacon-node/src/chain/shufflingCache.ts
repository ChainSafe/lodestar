import {CachedBeaconStateAllForks, EpochShuffling, getShufflingDecisionBlock} from "@lodestar/state-transition";
import {Epoch, RootHex} from "@lodestar/types";

/**
 * Same value to CheckpointBalancesCache, with the assumption that we don't have to use it for old epochs. In the worse case:
 * - when loading state bytes from disk, we need to compute shuffling for all epochs (~1s as of Sep 2023)
 * - don't have shuffling to verify attestations, need to do 1 epoch transition to add shuffling to this cache. This never happens
 * with default chain option of maxSkipSlots = 32
 **/
const MAX_SHUFFLING_CACHE_SIZE = 4;

type ShufflingCacheItem = {
  decisionBlockHex: RootHex;
  shuffling: EpochShuffling;
};

/**
 * A shuffling cache to help:
 * - get committee quickly for attestation verification
 * - skip computing shuffling when loading state bytes from disk
 */
export class ShufflingCache {
  private readonly items: ShufflingCacheItem[] = [];

  processState(state: CachedBeaconStateAllForks, shufflingEpoch: Epoch): void {
    const decisionBlockHex = getShufflingDecisionBlock(state, shufflingEpoch);
    const index = this.items.findIndex(
      (item) => item.shuffling.epoch === shufflingEpoch && item.decisionBlockHex === decisionBlockHex
    );
    if (index === -1) {
      if (this.items.length === MAX_SHUFFLING_CACHE_SIZE) {
        this.items.shift();
      }
      let shuffling: EpochShuffling;
      if (shufflingEpoch === state.epochCtx.nextShuffling.epoch) {
        shuffling = state.epochCtx.nextShuffling;
      } else if (shufflingEpoch === state.epochCtx.currentShuffling.epoch) {
        shuffling = state.epochCtx.currentShuffling;
      } else if (shufflingEpoch === state.epochCtx.previousShuffling.epoch) {
        shuffling = state.epochCtx.previousShuffling;
      } else {
        throw new Error(`Shuffling not found from state ${state.slot} for epoch ${shufflingEpoch}`);
      }
      this.items.push({decisionBlockHex, shuffling});
    }
  }

  get(shufflingEpoch: Epoch, dependentRootHex: RootHex): EpochShuffling | null {
    return (
      this.items.find((item) => item.shuffling.epoch === shufflingEpoch && item.decisionBlockHex === dependentRootHex)
        ?.shuffling ?? null
    );
  }
}
