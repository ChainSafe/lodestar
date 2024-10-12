import {CachedBeaconStateElectra, EpochTransitionCache} from "../types.js";
import {decreaseBalance, increaseBalance} from "../util/balance.js";
import {getMaxEffectiveBalance} from "../util/validator.js";

/**
 * Starting from Electra:
 * Process every `pendingConsolidation` in `state.pendingConsolidations`.
 * Churn limit was applied when enqueueing so we don't care about the limit here
 * However we only process consolidations up to current epoch
 *
 * For each valid `pendingConsolidation`, update withdrawal credential of target
 * validator to compounding, decrease balance of source validator and increase balance
 * of target validator.
 *
 * Dequeue all processed consolidations from `state.pendingConsolidation`
 *
 */
export function processPendingConsolidations(state: CachedBeaconStateElectra, cache: EpochTransitionCache): void {
  const nextEpoch = state.epochCtx.epoch + 1;
  let nextPendingConsolidation = 0;
  const validators = state.validators;
  const cachedBalances = cache.balances;

  for (const pendingConsolidation of state.pendingConsolidations.getAllReadonly()) {
    const {sourceIndex, targetIndex} = pendingConsolidation;
    const sourceValidator = validators.getReadonly(sourceIndex);

    if (sourceValidator.slashed) {
      nextPendingConsolidation++;
      continue;
    }

    if (sourceValidator.withdrawableEpoch > nextEpoch) {
      break;
    }
    // Move active balance to target. Excess balance is withdrawable.
    const maxEffectiveBalance = getMaxEffectiveBalance(state.validators.getReadonly(sourceIndex).withdrawalCredentials);
    const sourceEffectiveBalance = Math.min(state.balances.get(sourceIndex), maxEffectiveBalance);
    decreaseBalance(state, sourceIndex, sourceEffectiveBalance);
    increaseBalance(state, targetIndex, sourceEffectiveBalance);
    if (cachedBalances) {
      cachedBalances[sourceIndex] -= sourceEffectiveBalance;
      cachedBalances[targetIndex] += sourceEffectiveBalance;
    }

    nextPendingConsolidation++;
  }

  state.pendingConsolidations = state.pendingConsolidations.sliceFrom(nextPendingConsolidation);
}
