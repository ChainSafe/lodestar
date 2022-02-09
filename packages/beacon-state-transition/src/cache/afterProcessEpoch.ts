import {EFFECTIVE_BALANCE_INCREMENT, PROPOSER_WEIGHT, WEIGHT_DENOMINATOR} from "@chainsafe/lodestar-params";
import {allForks} from "@chainsafe/lodestar-types";
import {computeActivationExitEpoch, computeProposers, getChurnLimit} from "..";
import {computeBaseRewardPerIncrement} from "../altair/util/misc";
import {CachedBeaconState} from "./cachedBeaconState";
import {computeSyncParticipantReward} from "./epochContext";
import {IEpochProcess} from "./epochProcess";
import {computeEpochShuffling} from "./epochShuffling";

/**
 * Called to re-use information, such as the shuffling of the next epoch, after transitioning into a
 * new epoch.
 */
export function afterProcessEpoch(state: CachedBeaconState<allForks.BeaconState>, epochProcess: IEpochProcess): void {
  const {epochCtx} = state;
  epochCtx.previousShuffling = epochCtx.currentShuffling;
  epochCtx.currentShuffling = epochCtx.nextShuffling;
  const currEpoch = epochCtx.currentShuffling.epoch;
  const nextEpoch = currEpoch + 1;
  epochCtx.nextShuffling = computeEpochShuffling(
    state,
    epochProcess.nextEpochShufflingActiveValidatorIndices,
    nextEpoch
  );
  epochCtx.proposers = computeProposers(state, epochCtx.currentShuffling, epochCtx.effectiveBalanceIncrements);

  // TODO: DEDUPLICATE from createEpochContext
  //
  // Precompute churnLimit for efficient initiateValidatorExit() during block proposing MUST be recompute everytime the
  // active validator indices set changes in size. Validators change active status only when:
  // - validator.activation_epoch is set. Only changes in process_registry_updates() if validator can be activated. If
  //   the value changes it will be set to `epoch + 1 + MAX_SEED_LOOKAHEAD`.
  // - validator.exit_epoch is set. Only changes in initiate_validator_exit() if validator exits. If the value changes,
  //   it will be set to at least `epoch + 1 + MAX_SEED_LOOKAHEAD`.
  // ```
  // is_active_validator = validator.activation_epoch <= epoch < validator.exit_epoch
  // ```
  // So the returned value of is_active_validator(epoch) is guaranteed to not change during `MAX_SEED_LOOKAHEAD` epochs.
  //
  // activeIndices size is dependant on the state epoch. The epoch is advanced after running the epoch transition, and
  // the first block of the epoch process_block() call. So churnLimit must be computed at the end of the before epoch
  // transition and the result is valid until the end of the next epoch transition
  epochCtx.churnLimit = getChurnLimit(epochCtx.config, epochCtx.currentShuffling.activeIndices.length);

  // Maybe advance exitQueueEpoch at the end of the epoch if there haven't been any exists for a while
  const exitQueueEpoch = computeActivationExitEpoch(currEpoch);
  if (exitQueueEpoch > epochCtx.exitQueueEpoch) {
    epochCtx.exitQueueEpoch = exitQueueEpoch;
    epochCtx.exitQueueChurn = 0;
  }
  const totalActiveBalanceByIncrement = epochProcess.nextEpochTotalActiveBalanceByIncrement;
  epochCtx.totalActiveBalanceByIncrement = totalActiveBalanceByIncrement;
  if (currEpoch >= epochCtx.config.ALTAIR_FORK_EPOCH) {
    const totalActiveBalance = BigInt(totalActiveBalanceByIncrement) * BigInt(EFFECTIVE_BALANCE_INCREMENT);
    epochCtx.syncParticipantReward = computeSyncParticipantReward(epochCtx.config, totalActiveBalance);
    epochCtx.syncProposerReward = Math.floor(
      (epochCtx.syncParticipantReward * PROPOSER_WEIGHT) / (WEIGHT_DENOMINATOR - PROPOSER_WEIGHT)
    );

    epochCtx.baseRewardPerIncrement = computeBaseRewardPerIncrement(totalActiveBalanceByIncrement);
  }

  // Advance epochCtx time units
  // state.slot is advanced right before calling this function
  // ```
  // postState.slot++;
  // afterProcessEpoch(postState, epochProcess);
  // ```
  epochCtx.afterEpochTransitionSetTime(state.slot);
}
