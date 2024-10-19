import {
  EFFECTIVE_BALANCE_INCREMENT,
  ForkSeq,
  HYSTERESIS_DOWNWARD_MULTIPLIER,
  HYSTERESIS_QUOTIENT,
  HYSTERESIS_UPWARD_MULTIPLIER,
  MAX_EFFECTIVE_BALANCE,
  TIMELY_TARGET_FLAG_INDEX,
} from "@lodestar/params";
import {EpochTransitionCache, CachedBeaconStateAllForks, BeaconStateAltair} from "../types.js";
import {getMaxEffectiveBalance} from "../util/validator.js";

/** Same to https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#has_flag */
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;
/**
 * Update effective balances if validator.balance has changed enough
 *
 * PERF: Cost 'proportional' to $VALIDATOR_COUNT, to iterate over all balances. Then cost is proportional to the amount
 * of validators whose effectiveBalance changed. Worst case is a massive network leak or a big slashing event which
 * causes a large amount of the network to decrease their balance simultaneously.
 *
 * - On normal mainnet conditions 0 validators change their effective balance
 * - In case of big innactivity event a medium portion of validators may have their effectiveBalance updated
 *
 * Return number of validators updated
 */
export function processEffectiveBalanceUpdates(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  cache: EpochTransitionCache
): number {
  const HYSTERESIS_INCREMENT = EFFECTIVE_BALANCE_INCREMENT / HYSTERESIS_QUOTIENT;
  const DOWNWARD_THRESHOLD = HYSTERESIS_INCREMENT * HYSTERESIS_DOWNWARD_MULTIPLIER;
  const UPWARD_THRESHOLD = HYSTERESIS_INCREMENT * HYSTERESIS_UPWARD_MULTIPLIER;
  const {validators, epochCtx} = state;
  const {effectiveBalanceIncrements} = epochCtx;
  const forkSeq = epochCtx.config.getForkSeq(state.slot);
  let nextEpochTotalActiveBalanceByIncrement = 0;

  // update effective balances with hysteresis

  // epochTransitionCache.balances is initialized in processRewardsAndPenalties()
  // and updated in processPendingDeposits() and processPendingConsolidations()
  // so it's recycled here for performance.
  const balances = cache.balances ?? state.balances.getAll();
  const currentEpochValidators = cache.validators;

  let numUpdate = 0;
  for (let i = 0, len = balances.length; i < len; i++) {
    const balance = balances[i];

    // PERF: It's faster to access to get() every single element (4ms) than to convert to regular array then loop (9ms)
    let effectiveBalanceIncrement = effectiveBalanceIncrements[i];
    let effectiveBalance = effectiveBalanceIncrement * EFFECTIVE_BALANCE_INCREMENT;

    let effectiveBalanceLimit: number;
    if (fork < ForkSeq.electra) {
      effectiveBalanceLimit = MAX_EFFECTIVE_BALANCE;
    } else {
      // from electra, effectiveBalanceLimit is per validator
      effectiveBalanceLimit = getMaxEffectiveBalance(currentEpochValidators[i].withdrawalCredentials);
    }

    if (
      // Too big
      effectiveBalance > balance + DOWNWARD_THRESHOLD ||
      // Too small. Check effectiveBalance < MAX_EFFECTIVE_BALANCE to prevent unnecessary updates
      (effectiveBalance < effectiveBalanceLimit && effectiveBalance + UPWARD_THRESHOLD < balance)
    ) {
      // Update the state tree
      // Should happen rarely, so it's fine to update the tree
      const validator = validators.get(i);

      effectiveBalance = Math.min(balance - (balance % EFFECTIVE_BALANCE_INCREMENT), effectiveBalanceLimit);
      validator.effectiveBalance = effectiveBalance;
      // Also update the fast cached version
      const newEffectiveBalanceIncrement = Math.floor(effectiveBalance / EFFECTIVE_BALANCE_INCREMENT);

      // TODO: describe issue. Compute progressive target balances
      // Must update target balances for consistency, see comments below
      if (forkSeq >= ForkSeq.altair) {
        const deltaEffectiveBalanceIncrement = newEffectiveBalanceIncrement - effectiveBalanceIncrement;
        const {previousEpochParticipation, currentEpochParticipation} = state as BeaconStateAltair;

        if (!validator.slashed && (previousEpochParticipation.get(i) & TIMELY_TARGET) === TIMELY_TARGET) {
          epochCtx.previousTargetUnslashedBalanceIncrements += deltaEffectiveBalanceIncrement;
        }

        // currentTargetUnslashedBalanceIncrements is transfered to previousTargetUnslashedBalanceIncrements in afterEpochTransitionCache
        // at epoch transition of next epoch (in EpochTransitionCache), prevTargetUnslStake is calculated based on newEffectiveBalanceIncrement
        if (!validator.slashed && (currentEpochParticipation.get(i) & TIMELY_TARGET) === TIMELY_TARGET) {
          epochCtx.currentTargetUnslashedBalanceIncrements += deltaEffectiveBalanceIncrement;
        }
      }

      effectiveBalanceIncrement = newEffectiveBalanceIncrement;
      effectiveBalanceIncrements[i] = effectiveBalanceIncrement;
      numUpdate++;
    }

    // TODO: Do this in afterEpochTransitionCache, looping a Uint8Array should be very cheap
    if (cache.isActiveNextEpoch[i]) {
      // We track nextEpochTotalActiveBalanceByIncrement as ETH to fit total network balance in a JS number (53 bits)
      nextEpochTotalActiveBalanceByIncrement += effectiveBalanceIncrement;
    }
  }

  cache.nextEpochTotalActiveBalanceByIncrement = nextEpochTotalActiveBalanceByIncrement;
  return numUpdate;
}
