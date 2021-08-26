import {
  EFFECTIVE_BALANCE_INCREMENT,
  HYSTERESIS_DOWNWARD_MULTIPLIER,
  HYSTERESIS_QUOTIENT,
  HYSTERESIS_UPWARD_MULTIPLIER,
  MAX_EFFECTIVE_BALANCE,
} from "@chainsafe/lodestar-params";
import {allForks} from "@chainsafe/lodestar-types";
import {Gwei} from "../../phase0";
import {isActiveValidator} from "../../util";
import {IEpochProcess, CachedBeaconState} from "../util";

/**
 * Update effective balances if validator.balance has changed enough
 *
 * PERF: Cost 'proportional' to $VALIDATOR_COUNT, to iterate over all balances. Then cost is proportional to the amount
 * of validators whose effectiveBalance changed. Worst case is a massive network leak or a big slashing event which
 * causes a large amount of the network to decrease their balance simultaneously.
 *
 * - On normal mainnet conditions 0 validators change their effective balance
 * - In case of big innactivity event a medium portion of validators may have their effectiveBalance updated
 */
export function processEffectiveBalanceUpdates(
  state: CachedBeaconState<allForks.BeaconState>,
  epochProcess: IEpochProcess
): void {
  const {validators} = state;
  const HYSTERESIS_INCREMENT = EFFECTIVE_BALANCE_INCREMENT / HYSTERESIS_QUOTIENT;
  const DOWNWARD_THRESHOLD = HYSTERESIS_INCREMENT * HYSTERESIS_DOWNWARD_MULTIPLIER;
  const UPWARD_THRESHOLD = HYSTERESIS_INCREMENT * HYSTERESIS_UPWARD_MULTIPLIER;
  const {validators, epochCtx} = state;
  const nextEpoch = epochCtx.currentShuffling.epoch + 1;
  const isAltair = nextEpoch >= epochCtx.config.ALTAIR_FORK_EPOCH;
  let nextEpochTotalActiveBalanceByIncrement = 0;

  // update effective balances with hysteresis
  if (!epochProcess.balances) {
    // only do this for genesis epoch, or spec test
    epochProcess.balances = Array.from({length: state.balances.length}, (_, i) => state.balances[i]);
  }
  epochProcess.balances.forEach((balance: number, i: number) => {
    const validator = epochProcess.validators[i];
    let effectiveBalance = validator.effectiveBalance;
    if (
      // Too big
      effectiveBalance > balance + DOWNWARD_THRESHOLD ||
      // Too small. Check effectiveBalance < MAX_EFFECTIVE_BALANCE to prevent unnecessary updates
      (effectiveBalance < MAX_EFFECTIVE_BALANCE && effectiveBalance < balance - UPWARD_THRESHOLD)
    ) {
      effectiveBalance = Math.min(balance - (balance % EFFECTIVE_BALANCE_INCREMENT), MAX_EFFECTIVE_BALANCE);
      validators.update(i, {
        effectiveBalance,
      });
    }
    if (isAltair && isActiveValidator(validator, nextEpoch)) {
      nextEpochTotalActiveBalanceByIncrement += Math.floor(effectiveBalance / EFFECTIVE_BALANCE_INCREMENT);
    }
  });
  epochProcess.nextEpochTotalActiveBalanceByIncrement = nextEpochTotalActiveBalanceByIncrement;
}
