import {CachedBeaconStateElectra} from "../types.js";
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
export function processPendingConsolidations(state: CachedBeaconStateElectra): void {
  let _nextPendingConsolidation = 0;

  for (const pendingConsolidation of state.pendingConsolidations.getAllReadonly()) {
    const {sourceIndex, targetIndex} = pendingConsolidation;
    const sourceValidator = state.validators.getReadonly(sourceIndex);

    if (sourceValidator.slashed) {
      _nextPendingConsolidation++;
      continue;
    }

    if (sourceValidator.withdrawableEpoch > state.epochCtx.epoch) {
      break;
    }
    // Churn any target excess active balance of target and raise its max
    switchToCompoundingValidator(state, targetIndex);
    // Move active balance to target. Excess balance is withdrawable.
    const activeBalance = getActiveBalance(state, sourceIndex);
    decreaseBalance(state, sourceIndex, activeBalance);
    increaseBalance(state, targetIndex, activeBalance);

    _nextPendingConsolidation++;
  }

  // TODO Electra: impl slicing for ssz
  // const remainingPendingConsolidations = [];
  // state.pendingConsolidations =remainingPendingConsolidations
}
