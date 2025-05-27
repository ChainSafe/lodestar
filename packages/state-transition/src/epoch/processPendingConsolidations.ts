import {CachedBeaconStateElectra, EpochTransitionCache} from "../types.js";
import {decreaseBalance, increaseBalance} from "../util/balance.js";

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

  let chunkStartIndex = 0;
  const chunkSize = 100;
  const pendingConsolidationsLength = state.pendingConsolidations.length;
  outer: while (chunkStartIndex < pendingConsolidationsLength) {
    const consolidationChunk = state.pendingConsolidations.getReadonlyByRange(chunkStartIndex, chunkSize);

    for (const pendingConsolidation of consolidationChunk) {
      const {sourceIndex, targetIndex} = pendingConsolidation;
      const sourceValidator = validators.getReadonly(sourceIndex);

      if (sourceValidator.slashed) {
        nextPendingConsolidation++;
        continue;
      }

      if (sourceValidator.withdrawableEpoch > nextEpoch) {
        break outer;
      }

      // Calculate the consolidated balance
      const sourceEffectiveBalance = Math.min(state.balances.get(sourceIndex), sourceValidator.effectiveBalance);

      // Move active balance to target. Excess balance is withdrawable.
      decreaseBalance(state, sourceIndex, sourceEffectiveBalance);
      increaseBalance(state, targetIndex, sourceEffectiveBalance);
      if (cachedBalances) {
        cachedBalances[sourceIndex] -= sourceEffectiveBalance;
        cachedBalances[targetIndex] += sourceEffectiveBalance;
      }

      nextPendingConsolidation++;
    }
    chunkStartIndex += chunkSize;
  }

  state.pendingConsolidations = state.pendingConsolidations.sliceFrom(nextPendingConsolidation);
}
