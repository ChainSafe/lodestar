import {ForkSeq, GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {EpochProcess} from "../cache/epochProcess.js";
import {CachedBeaconStateAllForks, CachedBeaconStatePhase0, CachedBeaconStateAltair} from "../cache/stateCache.js";
import {getAttestationDeltas} from "./getAttestationDeltas.js";
import {getRewardsAndPenalties} from "./getRewardsAndPenalties.js";

/**
 * Iterate over all validator and compute rewards and penalties to apply to balances.
 *
 * PERF: Cost = 'proportional' to $VALIDATOR_COUNT. Extra work is done per validator the more status flags are set
 */
export function processRewardsAndPenalties(state: CachedBeaconStateAllForks, epochProcess: EpochProcess): void {
  // No rewards are applied at the end of `GENESIS_EPOCH` because rewards are for work done in the previous epoch
  if (epochProcess.currentEpoch === GENESIS_EPOCH) {
    return;
  }

  const fork = state.config.getForkSeq(state.slot);
  const [rewards, penalties] =
    fork === ForkSeq.phase0
      ? getAttestationDeltas(state as CachedBeaconStatePhase0, epochProcess)
      : getRewardsAndPenalties(state as CachedBeaconStateAltair, epochProcess);

  const balances = state.balances.getAll() as number[];

  for (let i = 0, len = rewards.length; i < len; i++) {
    balances[i] += rewards[i] - penalties[i];
  }

  // important: do not change state one balance at a time. Set them all at once, constructing the tree in one go
  // cache the balances array, too
  state.balances = ssz.phase0.Balances.toViewDU(balances);

  // For processEffectiveBalanceUpdates() to prevent having to re-compute the balances array.
  // For validator metrics
  epochProcess.balances = balances;
}
