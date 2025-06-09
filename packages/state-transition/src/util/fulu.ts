import {ForkSeq, MIN_SEED_LOOKAHEAD} from "@lodestar/params";
import {ValidatorIndex} from "@lodestar/types";
import {CachedBeaconStateElectra} from "../types.js";
import {computeProposerIndices} from "./seed.js";

/**
 * Return the proposer indices for the full available lookahead starting from current epoch.
 * Used to initialize the `proposer_lookahead` field in the beacon state at genesis and after forks.
 */
export function initializeProposerLookahead(state: CachedBeaconStateElectra): ValidatorIndex[] {
  const currentEpoch = state.epochCtx.epoch;

  const lookahead: ValidatorIndex[] = [];

  for (let i = 0; i < MIN_SEED_LOOKAHEAD + 1; i++) {
    lookahead.push(...computeProposerIndices(ForkSeq.fulu, state, currentEpoch + i));
  }

  return lookahead;
}
