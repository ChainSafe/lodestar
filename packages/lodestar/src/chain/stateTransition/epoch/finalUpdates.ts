/**
 * @module chain/stateTransition/epoch
 */

import {hashTreeRoot} from "@chainsafe/ssz";
import BN from "bn.js";

import {BeaconState, HistoricalBatch} from "@chainsafe/eth2-types";
import {IBeaconConfig} from "../../../config";

import {bnMin, intDiv} from "../../../util/math";

import {getActiveValidatorIndices, getCurrentEpoch, getRandaoMix, getShardDelta} from "../util";


export function processFinalUpdates(config: IBeaconConfig, state: BeaconState): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const nextEpoch = currentEpoch + 1;
  // Reset eth1 data votes
  if ((state.slot + 1) % config.params.SLOTS_PER_ETH1_VOTING_PERIOD === 0) {
    state.eth1DataVotes = [];
  }
  // Update effective balances with hysteresis
  state.validatorRegistry.forEach((validator, index) => {
    const balance = state.balances[index];
    // TODO probably unsafe
    const HALF_INCREMENT = config.params.EFFECTIVE_BALANCE_INCREMENT.divRound(new BN(2));
    if (balance.lt(validator.effectiveBalance) || validator.effectiveBalance
      .add(HALF_INCREMENT.muln(3)).lt(balance)) {
      validator.effectiveBalance = bnMin(
        balance.sub(balance.mod(config.params.EFFECTIVE_BALANCE_INCREMENT)),
        config.params.MAX_EFFECTIVE_BALANCE);
    }
  });
  // Update start shard
  state.latestStartShard =
    (state.latestStartShard + getShardDelta(config, state, currentEpoch)) % config.params.SHARD_COUNT;
  // Set active index root
  const indexRootPosition = (nextEpoch + config.params.ACTIVATION_EXIT_DELAY) % config.params.LATEST_ACTIVE_INDEX_ROOTS_LENGTH;
  state.latestActiveIndexRoots[indexRootPosition] = hashTreeRoot(
    getActiveValidatorIndices(state, nextEpoch + config.params.ACTIVATION_EXIT_DELAY), [config.types.ValidatorIndex]);
  // Set total slashed balances
  state.latestSlashedBalances[nextEpoch % config.params.LATEST_SLASHED_EXIT_LENGTH] =
    state.latestSlashedBalances[currentEpoch % config.params.LATEST_SLASHED_EXIT_LENGTH];
  // Set randao mix
  state.latestRandaoMixes[nextEpoch % config.params.LATEST_RANDAO_MIXES_LENGTH] =
    getRandaoMix(config, state, currentEpoch);
  // Set historical root accumulator
  if (nextEpoch % intDiv(config.params.SLOTS_PER_HISTORICAL_ROOT, config.params.SLOTS_PER_EPOCH) === 0) {
    const historicalBatch: HistoricalBatch = {
      blockRoots: state.latestBlockRoots,
      stateRoots: state.latestStateRoots,
    };
    state.historicalRoots.push(hashTreeRoot(historicalBatch, config.types.HistoricalBatch));
  }
  // Rotate current/previous epoch attestations
  state.previousEpochAttestations = state.currentEpochAttestations;
  state.currentEpochAttestations = [];
}
