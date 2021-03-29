import {phase0} from "@chainsafe/lodestar-types";
import {List, readonlyValues} from "@chainsafe/ssz";
import {bigIntMin, intDiv} from "@chainsafe/lodestar-utils";
import {getRandaoMix} from "../../../util";
import {IEpochProcess, CachedBeaconState} from "../util";

export function processFinalUpdates(state: CachedBeaconState<phase0.BeaconState>, process: IEpochProcess): void {
  const {config, validators} = state;
  const currentEpoch = process.currentEpoch;
  const nextEpoch = currentEpoch + 1;
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
  } = config.params;
  const HYSTERESIS_INCREMENT = EFFECTIVE_BALANCE_INCREMENT / BigInt(HYSTERESIS_QUOTIENT);
  const DOWNWARD_THRESHOLD = HYSTERESIS_INCREMENT * BigInt(HYSTERESIS_DOWNWARD_MULTIPLIER);
  const UPWARD_THRESHOLD = HYSTERESIS_INCREMENT * BigInt(HYSTERESIS_UPWARD_MULTIPLIER);

  // reset eth1 data votes
  if (nextEpoch % EPOCHS_PER_ETH1_VOTING_PERIOD === 0) {
    state.eth1DataVotes = ([] as phase0.Eth1Data[]) as List<phase0.Eth1Data>;
  }

  // update effective balances with hysteresis
  const balances =
    process.balances && process.balances.length > 0 ? process.balances : Array.from(readonlyValues(state.balances));
  for (let i = 0; i < process.statuses.length; i++) {
    const status = process.statuses[i];
    const balance = balances[i];
    const effectiveBalance = status.validator.effectiveBalance;
    if (balance + DOWNWARD_THRESHOLD < effectiveBalance || effectiveBalance + UPWARD_THRESHOLD < balance) {
      validators.update(i, {
        effectiveBalance: bigIntMin(balance - (balance % EFFECTIVE_BALANCE_INCREMENT), MAX_EFFECTIVE_BALANCE),
      });
    }
  }

  // reset slashings
  state.slashings[nextEpoch % EPOCHS_PER_SLASHINGS_VECTOR] = BigInt(0);

  // set randao mix
  state.randaoMixes[nextEpoch % EPOCHS_PER_HISTORICAL_VECTOR] = getRandaoMix(config, state, currentEpoch);

  // set historical root accumulator
  if (nextEpoch % intDiv(SLOTS_PER_HISTORICAL_ROOT, SLOTS_PER_EPOCH) === 0) {
    state.historicalRoots.push(
      config.types.phase0.HistoricalBatch.hashTreeRoot({
        blockRoots: state.blockRoots,
        stateRoots: state.stateRoots,
      })
    );
  }

  // rotate current/previous epoch attestations
  state.previousEpochAttestations = state.currentEpochAttestations;
  state.currentEpochAttestations = ([] as phase0.PendingAttestation[]) as List<phase0.PendingAttestation>;
}
