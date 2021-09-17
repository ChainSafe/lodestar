import {
  EFFECTIVE_BALANCE_INCREMENT,
  HYSTERESIS_DOWNWARD_MULTIPLIER,
  HYSTERESIS_QUOTIENT,
  HYSTERESIS_UPWARD_MULTIPLIER,
  MAX_EFFECTIVE_BALANCE,
} from "@chainsafe/lodestar-params";
import {allForks} from "@chainsafe/lodestar-types";
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
  const HYSTERESIS_INCREMENT = EFFECTIVE_BALANCE_INCREMENT / HYSTERESIS_QUOTIENT;
  const DOWNWARD_THRESHOLD = HYSTERESIS_INCREMENT * HYSTERESIS_DOWNWARD_MULTIPLIER;
  const UPWARD_THRESHOLD = HYSTERESIS_INCREMENT * HYSTERESIS_UPWARD_MULTIPLIER;
  const {validators, epochCtx} = state;
  const {effectiveBalances} = epochCtx;
  let nextEpochTotalActiveBalanceByIncrement = 0;

  // update effective balances with hysteresis
  if (!epochProcess.balances) {
    // only do this for genesis epoch, or spec test
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    epochProcess.balances = Array.from({length: state.balanceList.length}, (_, i) => state.balanceList.get(i)!);
  }

  for (let i = 0, len = epochProcess.balances.length; i < len; i++) {
    const balance = epochProcess.balances[i];
    // PERF: It's faster to access to get() every single element (4ms) than to convert to regular array then loop (9ms)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let effectiveBalance = effectiveBalances.get(i)!;
    if (
      // Too big
      effectiveBalance > balance + DOWNWARD_THRESHOLD ||
      // Too small. Check effectiveBalance < MAX_EFFECTIVE_BALANCE to prevent unnecessary updates
      (effectiveBalance < MAX_EFFECTIVE_BALANCE && effectiveBalance < balance - UPWARD_THRESHOLD)
    ) {
      effectiveBalance = Math.min(balance - (balance % EFFECTIVE_BALANCE_INCREMENT), MAX_EFFECTIVE_BALANCE);
      // Update the state tree
      validators[i].effectiveBalance = effectiveBalance;
      // Also update the fast cached version
      // Should happen rarely, so it's fine to update the tree
      // TODO: Update all in batch after this loop
      epochCtx.effectiveBalances.set(i, effectiveBalance);
    }
    if (epochProcess.isActiveNextEpoch[i]) {
      // We track nextEpochTotalActiveBalanceByIncrement as ETH to fit total network balance in a JS number (53 bits)
      nextEpochTotalActiveBalanceByIncrement += Math.floor(effectiveBalance / EFFECTIVE_BALANCE_INCREMENT);
    }
  }

  epochProcess.nextEpochTotalActiveBalanceByIncrement = nextEpochTotalActiveBalanceByIncrement;
}
