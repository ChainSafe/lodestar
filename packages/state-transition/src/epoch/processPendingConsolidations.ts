import {ValidatorIndex} from "@lodestar/types";
import {CachedBeaconStateElectra, EpochTransitionCache} from "../types.js";
import {decreaseBalance, increaseBalance} from "../util/balance.js";
import {getActiveBalance} from "../util/validator.js";
import {switchToCompoundingValidator} from "../util/electra.js";

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
  const newCompoundingValidators = new Set<ValidatorIndex>();

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
    // Churn any target excess active balance of target and raise its max
    switchToCompoundingValidator(state, targetIndex);
    newCompoundingValidators.add(targetIndex);
    // Move active balance to target. Excess balance is withdrawable.
    const activeBalance = getActiveBalance(state, sourceIndex);
    decreaseBalance(state, sourceIndex, activeBalance);
    increaseBalance(state, targetIndex, activeBalance);
    if (cachedBalances) {
      cachedBalances[sourceIndex] -= activeBalance;
      cachedBalances[targetIndex] += activeBalance;
    }

    nextPendingConsolidation++;
  }

  cache.newCompoundingValidators = newCompoundingValidators;
  state.pendingConsolidations = state.pendingConsolidations.sliceFrom(nextPendingConsolidation);
}
