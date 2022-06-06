import {ForkSeq, GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {CachedBeaconStateAllForks, CachedBeaconStateAltair, CachedBeaconStatePhase0, EpochProcess} from "../types.js";
import {getAttestationDeltas} from "./getAttestationDeltas.js";
import {getRewardsAndPenaltiesAltair} from "./getRewardsAndPenalties.js";

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

  const [rewards, penalties] = getRewardsAndPenalties(state, epochProcess);
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

// Note: abstracted in separate function for easier spec tests
export function getRewardsAndPenalties(
  state: CachedBeaconStateAllForks,
  epochProcess: EpochProcess
): [number[], number[]] {
  const fork = state.config.getForkSeq(state.slot);
  return fork === ForkSeq.phase0
    ? getAttestationDeltas(state as CachedBeaconStatePhase0, epochProcess)
    : getRewardsAndPenaltiesAltair(state as CachedBeaconStateAltair, epochProcess);
}
