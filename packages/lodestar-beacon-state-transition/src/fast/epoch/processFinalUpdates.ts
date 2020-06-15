import {BeaconState} from "@chainsafe/lodestar-types";
import {bigIntMin} from "@chainsafe/lodestar-utils";

import {getRandaoMix} from "../../util";
import {EpochContext, IEpochProcess} from "../util";

export function processFinalUpdates(
  epochCtx: EpochContext,
  process: IEpochProcess,
  state: BeaconState
): void {
  const config = epochCtx.config;
  const currentEpoch = process.currentEpoch;
  const nextEpoch = currentEpoch + 1n;
  const {
    EFFECTIVE_BALANCE_INCREMENT,
    EPOCHS_PER_ETH1_VOTING_PERIOD,
    EPOCHS_PER_HISTORICAL_VECTOR,
    EPOCHS_PER_SLASHINGS_VECTOR,
    HYSTERESIS_QUOTIENT,
    HYSTERESIS_DOWNWARD_MULTIPLIER,
    HYSTERESIS_UPWARD_MULTIPLIER,
    MAX_EFFECTIVE_BALANCE,
    SLOTS_PER_HISTORICAL_ROOT,
    SLOTS_PER_EPOCH,
  } = epochCtx.config.params;
  const HYSTERESIS_INCREMENT = EFFECTIVE_BALANCE_INCREMENT / BigInt(HYSTERESIS_QUOTIENT);
  const DOWNWARD_THRESHOLD = HYSTERESIS_INCREMENT * BigInt(HYSTERESIS_DOWNWARD_MULTIPLIER);
  const UPWARD_THRESHOLD = HYSTERESIS_INCREMENT * BigInt(HYSTERESIS_UPWARD_MULTIPLIER);

  // reset eth1 data votes
  if (nextEpoch % EPOCHS_PER_ETH1_VOTING_PERIOD === 0n) {
    state.eth1DataVotes = [];
  }

  // update effective balances with hysteresis
  // TODO fast read-only iteration
  const balances = Array.from(state.balances);
  for (let i = 0; i < process.statuses.length; i++) {
    const status = process.statuses[i];
    const balance = balances[i];
    const effectiveBalance = status.validator.effectiveBalance;
    if (balance + DOWNWARD_THRESHOLD < effectiveBalance || effectiveBalance + UPWARD_THRESHOLD < balance) {
      state.validators[i].effectiveBalance = bigIntMin(
        balance - balance % EFFECTIVE_BALANCE_INCREMENT,
        MAX_EFFECTIVE_BALANCE,
      );
    }
  }

  // reset slashings
  state.slashings[Number(nextEpoch % EPOCHS_PER_SLASHINGS_VECTOR)] = BigInt(0);

  // set randao mix
  state.randaoMixes[Number(nextEpoch  % EPOCHS_PER_HISTORICAL_VECTOR)] = getRandaoMix(config, state, currentEpoch);

  // set historical root accumulator
  if (nextEpoch % SLOTS_PER_HISTORICAL_ROOT / SLOTS_PER_EPOCH === 0n) {
    state.historicalRoots.push(
      config.types.HistoricalBatch.hashTreeRoot({
        blockRoots: state.blockRoots,
        stateRoots: state.stateRoots,
      })
    );
  }

  // rotate current/previous epoch attestations
  state.previousEpochAttestations = state.currentEpochAttestations;
  state.currentEpochAttestations = [];
}
