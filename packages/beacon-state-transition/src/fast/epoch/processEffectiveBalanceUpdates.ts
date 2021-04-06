import {allForks} from "@chainsafe/lodestar-types";
import {readonlyValues} from "@chainsafe/ssz";
import {bigIntMin} from "@chainsafe/lodestar-utils";
import {IEpochProcess, CachedBeaconState} from "../util";

export function processEffectiveBalanceUpdates(
  state: CachedBeaconState<allForks.BeaconState>,
  process: IEpochProcess
): void {
  const {config, validators} = state;
  const {
    EFFECTIVE_BALANCE_INCREMENT,
    HYSTERESIS_QUOTIENT,
    HYSTERESIS_DOWNWARD_MULTIPLIER,
    HYSTERESIS_UPWARD_MULTIPLIER,
    MAX_EFFECTIVE_BALANCE,
  } = config.params;
  const HYSTERESIS_INCREMENT = EFFECTIVE_BALANCE_INCREMENT / BigInt(HYSTERESIS_QUOTIENT);
  const DOWNWARD_THRESHOLD = HYSTERESIS_INCREMENT * BigInt(HYSTERESIS_DOWNWARD_MULTIPLIER);
  const UPWARD_THRESHOLD = HYSTERESIS_INCREMENT * BigInt(HYSTERESIS_UPWARD_MULTIPLIER);

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
}
