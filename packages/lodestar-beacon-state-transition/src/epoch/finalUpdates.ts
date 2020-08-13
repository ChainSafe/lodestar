/**
 * @module chain/stateTransition/epoch
 */

import {List} from "@chainsafe/ssz";
import {BeaconState, HistoricalBatch, Eth1Data, PendingAttestation} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  getCurrentEpoch,
  getRandaoMix
} from "../util";
import {bigIntMin, intDiv} from "@chainsafe/lodestar-utils";


export function processFinalUpdates(config: IBeaconConfig, state: BeaconState): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const nextEpoch = currentEpoch + 1;
  // Reset eth1 data votes
  if (nextEpoch % config.params.EPOCHS_PER_ETH1_VOTING_PERIOD === 0) {
    state.eth1DataVotes = [] as Eth1Data[] as List<Eth1Data>;
  }
  // Update effective balances with hysteresis
  state.validators.forEach((validator, index) => {
    const balance = state.balances[index];
    const HYSTERESIS_INCREMENT = config.params.EFFECTIVE_BALANCE_INCREMENT / BigInt(config.params.HYSTERESIS_QUOTIENT);
    const DOWNWARD_THRESHOLD = HYSTERESIS_INCREMENT * BigInt(config.params.HYSTERESIS_DOWNWARD_MULTIPLIER);
    const UPWARD_THRESHOLD = HYSTERESIS_INCREMENT * BigInt(config.params.HYSTERESIS_UPWARD_MULTIPLIER);
    if (
      ((balance + DOWNWARD_THRESHOLD) < validator.effectiveBalance) ||
      ((validator.effectiveBalance + UPWARD_THRESHOLD) < balance)
    ) {
      validator.effectiveBalance = bigIntMin(
        balance - (balance % config.params.EFFECTIVE_BALANCE_INCREMENT),
        config.params.MAX_EFFECTIVE_BALANCE);
    }
  });
  // Reset slashings
  state.slashings[nextEpoch % config.params.EPOCHS_PER_SLASHINGS_VECTOR] = 0n;
  // Set randao mix
  state.randaoMixes[nextEpoch % config.params.EPOCHS_PER_HISTORICAL_VECTOR] =
    getRandaoMix(config, state, currentEpoch);
  // Set historical root accumulator
  if (nextEpoch % intDiv(config.params.SLOTS_PER_HISTORICAL_ROOT, config.params.SLOTS_PER_EPOCH) === 0) {
    const historicalBatch: HistoricalBatch = {
      blockRoots: state.blockRoots,
      stateRoots: state.stateRoots,
    };
    state.historicalRoots.push(config.types.HistoricalBatch.hashTreeRoot(historicalBatch));
  }
  // Rotate current/previous epoch attestations
  state.previousEpochAttestations = state.currentEpochAttestations;
  state.currentEpochAttestations = [] as PendingAttestation[] as List<PendingAttestation>;
}
