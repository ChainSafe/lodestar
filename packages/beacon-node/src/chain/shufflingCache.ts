import {CachedBeaconStateAllForks, EpochShuffling, getShufflingDecisionBlock} from "@lodestar/state-transition";
import {Epoch, RootHex} from "@lodestar/types";

/**
 * Same value to CheckpointBalancesCache, with the assumption that we don't have to use it old epochs. In the worse case:
 * - when loading state bytes from disk, we need to compute shuffling for all epochs (~1s as of Sep 2023)
 * - don't have shuffling to verify attestations: TODO, not implemented
 **/
const MAX_SHUFFLING_CACHE_SIZE = 4;

type ShufflingCacheItem = {
  decisionBlockHex: RootHex;
  shuffling: EpochShuffling;
};

/**
 * A shuffling cache to help:
 * - get committee quickly for attestation verification (TODO)
 * - skip computing shuffling when loading state bytes from disk
 */
export class ShufflingCache {
  private readonly items: ShufflingCacheItem[] = [];

  processState(state: CachedBeaconStateAllForks): void {
    // current epoch and previous epoch are likely cached in previous states
    const nextEpoch = state.epochCtx.currentShuffling.epoch + 1;
    const decisionBlockHex = getShufflingDecisionBlock(state, nextEpoch);
    const index = this.items.findIndex(
      (item) => item.shuffling.epoch === nextEpoch && item.decisionBlockHex === decisionBlockHex
    );
    if (index === -1) {
      if (this.items.length === MAX_SHUFFLING_CACHE_SIZE) {
        this.items.shift();
      }
      this.items.push({decisionBlockHex, shuffling: state.epochCtx.nextShuffling});
    }
  }

  get(shufflingEpoch: Epoch, dependentRootHex: RootHex): EpochShuffling | null {
    return (
      this.items.find((item) => item.shuffling.epoch === shufflingEpoch && item.decisionBlockHex === dependentRootHex)
        ?.shuffling ?? null
    );
  }
}
