import {ForkSeq, MIN_SEED_LOOKAHEAD} from "@lodestar/params";
import {ValidatorIndex} from "@lodestar/types";
import {CachedBeaconStateElectra} from "../types.js";
import {computeEpochShuffling} from "./epochShuffling.js";
import {computeProposerIndices} from "./seed.js";
import {getActiveValidatorIndices} from "./validator.js";

/**
 * Return the proposer indices for the full available lookahead starting from current epoch.
 * Used to initialize the `proposer_lookahead` field in the beacon state at genesis and after forks.
 */
export function initializeProposerLookahead(state: CachedBeaconStateElectra): ValidatorIndex[] {
  const currentEpoch = state.epochCtx.epoch;

  const lookahead: ValidatorIndex[] = [];

  for (let i = 0; i <= MIN_SEED_LOOKAHEAD; i++) {
    const epoch = currentEpoch + i;

    // Try to pull cached shuffling first
    let shuffling = state.epochCtx.getShufflingAtEpochOrNull(epoch);

    if (!shuffling) {
      // Only compute epoch shuffling if cache is not yet populated
      let activeIndices: Uint32Array;
      if (epoch === currentEpoch) {
        // This should never happen as current shuffling will always be cached
        activeIndices = state.epochCtx.currentShuffling.activeIndices;
      } else if (epoch === currentEpoch + 1) {
        activeIndices = state.epochCtx.nextActiveIndices;
      } else {
        // This will never be reached with current spec as `MIN_SEED_LOOKAHEAD == 1`
        activeIndices = getActiveValidatorIndices(state, epoch);
      }

      shuffling = computeEpochShuffling(state, activeIndices, epoch);
    }

    lookahead.push(...computeProposerIndices(ForkSeq.fulu, state, shuffling, epoch));
  }

  return lookahead;
}
