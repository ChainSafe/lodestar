/**
 * @module chain/stateTransition/epoch
 */

import BN from "bn.js";
import {hashTreeRoot} from "@chainsafe/ssz";

import {BeaconState, ValidatorIndex, HistoricalBatch} from "../../../types";

import {
  ACTIVATION_EXIT_DELAY, LATEST_ACTIVE_INDEX_ROOTS_LENGTH, LATEST_RANDAO_MIXES_LENGTH,
  LATEST_SLASHED_EXIT_LENGTH,
  SLOTS_PER_HISTORICAL_ROOT,
  SLOTS_PER_EPOCH,
  MAX_EFFECTIVE_BALANCE,
  SLOTS_PER_ETH1_VOTING_PERIOD,
  EFFECTIVE_BALANCE_INCREMENT,
  SHARD_COUNT
} from "../../../constants";

import {bnMin, intDiv} from "../../../util/math";

import {getActiveValidatorIndices, getRandaoMix, getCurrentEpoch, getShardDelta} from "../util";


export function processFinalUpdates(state: BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  const nextEpoch = currentEpoch + 1;
  // Reset eth1 data votes
  if ((state.slot + 1) % SLOTS_PER_ETH1_VOTING_PERIOD === 0) {
    state.eth1DataVotes = [];
  }
  // Update effective balances with hysteresis
  state.validatorRegistry.forEach((validator, index) => {
    const balance = state.balances[index];
    // TODO probably unsafe
    const HALF_INCREMENT = intDiv(EFFECTIVE_BALANCE_INCREMENT, 2);
    if (balance.lt(validator.effectiveBalance) || validator.effectiveBalance
      .add(new BN(HALF_INCREMENT).muln(3)).lt(balance)) {
      validator.effectiveBalance = bnMin(
        balance.sub(new BN(balance.modn(EFFECTIVE_BALANCE_INCREMENT))),
        new BN(MAX_EFFECTIVE_BALANCE));
    }
  });
  // Update start shard
  state.latestStartShard =
    (state.latestStartShard + getShardDelta(state, currentEpoch)) % SHARD_COUNT;
  // Set active index root
  const indexRootPosition = (nextEpoch + ACTIVATION_EXIT_DELAY) % LATEST_ACTIVE_INDEX_ROOTS_LENGTH;
  state.latestActiveIndexRoots[indexRootPosition] = hashTreeRoot(
    getActiveValidatorIndices(state, nextEpoch + ACTIVATION_EXIT_DELAY), [ValidatorIndex]);
  // Set total slashed balances
  state.latestSlashedBalances[nextEpoch % LATEST_SLASHED_EXIT_LENGTH] =
    state.latestSlashedBalances[currentEpoch % LATEST_SLASHED_EXIT_LENGTH];
  // Set randao mix
  state.latestRandaoMixes[nextEpoch % LATEST_RANDAO_MIXES_LENGTH] =
    getRandaoMix(state, currentEpoch);
  // Set historical root accumulator
  if (nextEpoch % intDiv(SLOTS_PER_HISTORICAL_ROOT, SLOTS_PER_EPOCH) === 0) {
    const historicalBatch: HistoricalBatch = {
      blockRoots: state.latestBlockRoots,
      stateRoots: state.latestStateRoots,
    };
    state.historicalRoots.push(hashTreeRoot(historicalBatch, HistoricalBatch));
  }
  // Rotate current/previous epoch attestations
  state.previousEpochAttestations = state.currentEpochAttestations;
  state.currentEpochAttestations = [];
}
