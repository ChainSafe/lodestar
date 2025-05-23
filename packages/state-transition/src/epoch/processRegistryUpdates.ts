import {ForkSeq} from "@lodestar/params";
import {initiateValidatorExit} from "../block/index.js";
import {CachedBeaconStateAllForks, EpochTransitionCache} from "../types.js";
import {computeActivationExitEpoch} from "../util/index.js";

/**
 * Update validator registry for validators that activate + exit
 *
 * PERF: Cost 'proportional' to only validators that active + exit. For mainnet conditions:
 * - indicesEligibleForActivationQueue: Maxing deposits triggers 512 validator mutations
 * - indicesEligibleForActivation: 4 per epoch
 * - indicesToEject: Potentially the entire validator set. On a massive offline event this could trigger many mutations
 *   per epoch. Note that once mutated that validator can't be added to indicesToEject.
 *
 * - On normal mainnet conditions only 4 validators will be updated
 *   - indicesEligibleForActivation: ~4000
 *   - indicesEligibleForActivationQueue: 0
 *   - indicesToEject: 0
 */
export function processRegistryUpdates(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  cache: EpochTransitionCache
): void {
  const {epochCtx} = state;

  // Get the validators sub tree once for all the loop
  const validators = state.validators;

  // TODO: Batch set this properties in the tree at once with setMany() or setNodes()

  // process ejections
  for (const index of cache.indicesToEject) {
    // set validator exit epoch and withdrawable epoch
    // TODO: Figure out a way to quickly set properties on the validators tree
    initiateValidatorExit(fork, state, validators.get(index));
  }

  // set new activation eligibilities
  for (const index of cache.indicesEligibleForActivationQueue) {
    validators.get(index).activationEligibilityEpoch = epochCtx.epoch + 1;
  }

  const finalityEpoch = state.finalizedCheckpoint.epoch;
  // this avoids an array allocation compared to `slice(0, epochCtx.activationChurnLimit)`
  const len =
    fork < ForkSeq.electra
      ? Math.min(cache.indicesEligibleForActivation.length, epochCtx.activationChurnLimit)
      : cache.indicesEligibleForActivation.length;
  const activationEpoch = computeActivationExitEpoch(cache.currentEpoch);
  // dequeue validators for activation up to churn limit
  for (let i = 0; i < len; i++) {
    const validatorIndex = cache.indicesEligibleForActivation[i];
    const validator = validators.get(validatorIndex);
    // placement in queue is finalized
    if (validator.activationEligibilityEpoch > finalityEpoch) {
      // remaining validators all have an activationEligibilityEpoch that is higher anyway, break early
      // activationEligibilityEpoch has been sorted in epoch process in ascending order.
      // At that point the finalityEpoch was not known because processJustificationAndFinalization() wasn't called yet.
      // So we need to filter by finalityEpoch here to comply with the spec.
      break;
    }
    validator.activationEpoch = activationEpoch;
  }
}
