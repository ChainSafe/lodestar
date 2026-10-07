import {EPOCHS_PER_ETH1_VOTING_PERIOD} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateAllForks, CachedBeaconStatePhase0, EpochTransitionCache} from "../types.js";

/**
 * Reset eth1DataVotes tree every `EPOCHS_PER_ETH1_VOTING_PERIOD`.
 *
 * PERF: Almost no (constant) cost
 */
export function processEth1DataReset(state: CachedBeaconStateAllForks, cache: EpochTransitionCache): void {
  const statePhase0 = state as CachedBeaconStatePhase0;
  const nextEpoch = cache.currentEpoch + 1;

  // reset eth1 data votes
  if (nextEpoch % EPOCHS_PER_ETH1_VOTING_PERIOD === 0) {
    statePhase0.eth1DataVotes = ssz.phase0.Eth1DataVotes.defaultViewDU();
  }
}
