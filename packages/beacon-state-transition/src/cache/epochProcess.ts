import {Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {
  EPOCHS_PER_SLASHINGS_VECTOR,
  FAR_FUTURE_EPOCH,
  ForkName,
  MAX_EFFECTIVE_BALANCE,
} from "@chainsafe/lodestar-params";

import {
  IAttesterStatus,
  createIAttesterStatus,
  hasMarkers,
  FLAG_UNSLASHED,
  FLAG_ELIGIBLE_ATTESTER,
  FLAG_PREV_SOURCE_ATTESTER,
  FLAG_PREV_TARGET_ATTESTER,
  FLAG_PREV_HEAD_ATTESTER,
  FLAG_CURR_SOURCE_ATTESTER,
  FLAG_CURR_TARGET_ATTESTER,
  FLAG_CURR_HEAD_ATTESTER,
} from "../util/attesterStatus.js";
import {statusProcessEpoch} from "../phase0/epoch/processPendingAttestations.js";
import {CachedBeaconStateAllForks, CachedBeaconStateAltair, CachedBeaconStatePhase0} from "..";
import {computeBaseRewardPerIncrement} from "../util/altair.js";

/* eslint-disable @typescript-eslint/naming-convention */

/**
 * EpochProcess is the parent object of:
 * - Any data-structures not part of the spec'ed BeaconState
 * - Necessary to only compute data once
 * - Only necessary for epoch processing, can be disposed immediatelly
 * - Not already part of `EpochContext` {@see} {@link EpochContext}
 *
 * EpochProcess speeds up epoch processing as a whole at the cost of more memory temporarily. This is okay since
 * only epoch process is done at once, limiting the max total memory increase. In summary it helps:
 * - Only loop state.validators once for all `process_*` fns
 * - Only loop status array once
 */
export interface EpochProcess {
  prevEpoch: Epoch;
  currentEpoch: Epoch;
  /**
   * This is sum of active validators' balance in eth.
   */
  totalActiveStakeByIncrement: number;
  /** For altair */
  baseRewardPerIncrement: number;
  prevEpochUnslashedStake: {
    sourceStakeByIncrement: number;
    targetStakeByIncrement: number;
    headStakeByIncrement: number;
  };
  currEpochUnslashedTargetStakeByIncrement: number;

  /**
   * Validator indices that are either
   * - active in previous epoch
   * - slashed and not yet withdrawable
   *
   * getRewardsAndPenalties() and processInactivityUpdates() iterate this list
   */
  eligibleValidatorIndices: ValidatorIndex[];

  /**
   * Indices which will receive the slashing penalty
   * ```
   * v.withdrawableEpoch === currentEpoch + EPOCHS_PER_SLASHINGS_VECTOR / 2
   * ```
   * There's a practical limitation in number of possible validators slashed by epoch, which would share the same
   * withdrawableEpoch. Note that after some count exitChurn would advance the withdrawableEpoch.
   * ```
   * maxSlashedPerSlot = SLOTS_PER_EPOCH * (MAX_PROPOSER_SLASHINGS + MAX_ATTESTER_SLASHINGS * bits)
   * ```
   * For current mainnet conditions (bits = 128) that's `maxSlashedPerSlot = 8704`.
   * For less than 327680 validators, churnLimit = 4 (minimum possible)
   * For exitChurn to overtake the slashing delay, there should be
   * ```
   * churnLimit * (EPOCHS_PER_SLASHINGS_VECTOR / 2 - 1 - MAX_SEED_LOOKAHEAD)
   * ```
   * For mainnet conditions that's 16364 validators. So the limiting factor is the max operations on the block. Note
   * that on average indicesToSlash must contain churnLimit validators (4), but it can spike to a max of 8704 in a
   * single epoch if there haven't been exits in a while and there's a massive attester slashing at once of validators
   * that happen to be in the same committee, which is very unlikely.
   */
  indicesToSlash: ValidatorIndex[];

  /**
   * Indices of validators that just joinned and will be eligible for the active queue.
   * ```
   * v.activationEligibilityEpoch === FAR_FUTURE_EPOCH && v.effectiveBalance === MAX_EFFECTIVE_BALANCE
   * ```
   * All validators in indicesEligibleForActivationQueue get activationEligibilityEpoch set. So it can only include
   * validators that have just joinned the registry through a valid full deposit(s).
   * ```
   * max indicesEligibleForActivationQueue = SLOTS_PER_EPOCH * MAX_DEPOSITS
   * ```
   * For mainnet spec = 512
   */
  indicesEligibleForActivationQueue: ValidatorIndex[];

  /**
   * Indices of validators that may become active once churn and finaly allow.
   * ```
   * v.activationEpoch === FAR_FUTURE_EPOCH && v.activationEligibilityEpoch <= currentEpoch
   * ```
   * Many validators could be on indicesEligibleForActivation, but only up to churnLimit will be activated.
   * For less than 327680 validators, churnLimit = 4 (minimum possible), so max processed is 4.
   */
  indicesEligibleForActivation: ValidatorIndex[];

  /**
   * Indices of validators that will be ejected due to low balance.
   * ```
   * status.active && v.exitEpoch === FAR_FUTURE_EPOCH && v.effectiveBalance <= config.EJECTION_BALANCE
   * ```
   * Potentially the entire validator set could be added to indicesToEject, and all validators in the array will have
   * their validator object mutated. Exit queue churn delays exit, but the object is mutated immediately.
   */
  indicesToEject: ValidatorIndex[];

  /**
   * Pre-computes status flags for faster checking of statuses during epoch transition.
   * Spec requires some reward or penalty to apply to
   * - eligible validators
   * - un-slashed validators
   * - prev attester flag set
   * With a status flag to check this conditions at once we just have to mask with an OR of the conditions.
   */
  statuses: IAttesterStatus[];

  /**
   * balances array will be populated by processRewardsAndPenalties() and consumed by processEffectiveBalanceUpdates().
   * processRewardsAndPenalties() already has a regular Javascript array of balances.
   * Then processEffectiveBalanceUpdates() needs to iterate all balances so it can re-use the array pre-computed previously.
   */
  balances?: number[];

  /**
   * Active validator indices for currentEpoch + 2.
   * This is only used in `afterProcessEpoch` to compute epoch shuffling, it's not efficient to calculate it at that time
   * since it requires 1 loop through validator.
   * | epoch process fn                 | nextEpochTotalActiveBalance action |
   * | -------------------------------- | ---------------------------------- |
   * | beforeProcessEpoch               | calculate during the validator loop|
   * | afterEpochProcess                | read it                            |
   */
  nextEpochShufflingActiveValidatorIndices: ValidatorIndex[];

  /**
   * Altair specific, this is total active balances for the next epoch.
   * This is only used in `afterProcessEpoch` to compute base reward and sync participant reward.
   * It's not efficient to calculate it at that time since it requires looping through all active validators,
   * so we should calculate it during `processEffectiveBalancesUpdate` which gives us updated effective balance.
   * | epoch process fn                 | nextEpochTotalActiveBalance action |
   * | -------------------------------- | ---------------------------------- |
   * | beforeProcessEpoch               | initialize as BigInt(0)            |
   * | processEffectiveBalancesUpdate   | calculate during the loop          |
   * | afterEpochProcess                | read it                            |
   */
  nextEpochTotalActiveBalanceByIncrement: number;

  /**
   * Track by validator index if it's active in the next epoch.
   * Used in `processEffectiveBalanceUpdates` to save one loop over validators after epoch process.
   */
  isActiveNextEpoch: boolean[];
}

export function beforeProcessEpoch(state: CachedBeaconStateAllForks): EpochProcess {
  const {config, epochCtx} = state;
  const forkName = config.getForkName(state.slot);
  const currentEpoch = epochCtx.currentShuffling.epoch;
  const prevEpoch = epochCtx.previousShuffling.epoch;
  const nextEpoch = currentEpoch + 1;
  // active validator indices for nextShuffling is ready, we want to precalculate for the one after that
  const nextEpoch2 = currentEpoch + 2;

  const slashingsEpoch = currentEpoch + intDiv(EPOCHS_PER_SLASHINGS_VECTOR, 2);

  const eligibleValidatorIndices: ValidatorIndex[] = [];
  const indicesToSlash: ValidatorIndex[] = [];
  const indicesEligibleForActivationQueue: ValidatorIndex[] = [];
  const indicesEligibleForActivation: ValidatorIndex[] = [];
  const indicesToEject: ValidatorIndex[] = [];
  const nextEpochShufflingActiveValidatorIndices: ValidatorIndex[] = [];
  const isActivePrevEpoch: boolean[] = [];
  const isActiveNextEpoch: boolean[] = [];
  const statuses: IAttesterStatus[] = [];

  let totalActiveStakeByIncrement = 0;

  // To optimize memory each validator node in `state.validators` is represented with a special node type
  // `BranchNodeStruct` that represents the data as struct internally. This utility grabs the struct data directrly
  // from the nodes without any extra transformation. The returned `validators` array contains native JS objects.
  const validators = state.validators.getAllReadonlyValues();
  const validatorCount = validators.length;

  // Clone before being mutated in processEffectiveBalanceUpdates
  epochCtx.beforeEpochTransition();

  const effectiveBalancesByIncrements = epochCtx.effectiveBalanceIncrements;

  for (let i = 0; i < validatorCount; i++) {
    const validator = validators[i];
    const status = createIAttesterStatus();

    if (validator.slashed) {
      if (slashingsEpoch === validator.withdrawableEpoch) {
        indicesToSlash.push(i);
      }
    } else {
      status.flags |= FLAG_UNSLASHED;
    }

    const {activationEpoch, exitEpoch} = validator;
    const isActivePrev = activationEpoch <= prevEpoch && prevEpoch < exitEpoch;
    const isActiveCurr = activationEpoch <= currentEpoch && currentEpoch < exitEpoch;
    const isActiveNext = activationEpoch <= nextEpoch && nextEpoch < exitEpoch;
    const isActiveNext2 = activationEpoch <= nextEpoch2 && nextEpoch2 < exitEpoch;

    isActivePrevEpoch.push(isActivePrev);

    // Both active validators and slashed-but-not-yet-withdrawn validators are eligible to receive penalties.
    // This is done to prevent self-slashing from being a way to escape inactivity leaks.
    // TODO: Consider using an array of `eligibleValidatorIndices: number[]`
    if (isActivePrev || (validator.slashed && prevEpoch + 1 < validator.withdrawableEpoch)) {
      eligibleValidatorIndices.push(i);
      status.flags |= FLAG_ELIGIBLE_ATTESTER;
    }

    if (isActiveCurr) {
      status.active = true;
      totalActiveStakeByIncrement += effectiveBalancesByIncrements[i];
    }

    // To optimize process_registry_updates():
    // ```python
    // def is_eligible_for_activation_queue(validator: Validator) -> bool:
    //   return (
    //     validator.activation_eligibility_epoch == FAR_FUTURE_EPOCH
    //     and validator.effective_balance == MAX_EFFECTIVE_BALANCE
    //   )
    // ```
    if (
      validator.activationEligibilityEpoch === FAR_FUTURE_EPOCH &&
      validator.effectiveBalance === MAX_EFFECTIVE_BALANCE
    ) {
      indicesEligibleForActivationQueue.push(i);
    }

    // To optimize process_registry_updates():
    // ```python
    // def is_eligible_for_activation(state: BeaconState, validator: Validator) -> bool:
    //   return (
    //     validator.activation_eligibility_epoch <= state.finalized_checkpoint.epoch  # Placement in queue is finalized
    //     and validator.activation_epoch == FAR_FUTURE_EPOCH                          # Has not yet been activated
    //   )
    // ```
    // Here we have to check if `activationEligibilityEpoch <= currentEpoch` instead of finalized checkpoint, because the finalized
    // checkpoint may change during epoch processing at processJustificationAndFinalization(), which is called before processRegistryUpdates().
    // Then in processRegistryUpdates() we will check `activationEligibilityEpoch <= finalityEpoch`. This is to keep the array small.
    //
    // Use `else` since indicesEligibleForActivationQueue + indicesEligibleForActivation are mutually exclusive
    else if (validator.activationEpoch === FAR_FUTURE_EPOCH && validator.activationEligibilityEpoch <= currentEpoch) {
      indicesEligibleForActivation.push(i);
    }

    // To optimize process_registry_updates():
    // ```python
    // if is_active_validator(validator, get_current_epoch(state)) and validator.effective_balance <= EJECTION_BALANCE:
    // ```
    // Adding extra condition `exitEpoch === FAR_FUTURE_EPOCH` to keep the array as small as possible. initiateValidatorExit() will ignore them anyway
    //
    // Use `else` since indicesEligibleForActivationQueue + indicesEligibleForActivation + indicesToEject are mutually exclusive
    else if (
      status.active &&
      validator.exitEpoch === FAR_FUTURE_EPOCH &&
      validator.effectiveBalance <= config.EJECTION_BALANCE
    ) {
      indicesToEject.push(i);
    }

    statuses.push(status);

    isActiveNextEpoch.push(isActiveNext);

    if (isActiveNext2) {
      nextEpochShufflingActiveValidatorIndices.push(i);
    }
  }

  if (totalActiveStakeByIncrement < 1) {
    totalActiveStakeByIncrement = 1;
  } else if (totalActiveStakeByIncrement >= Number.MAX_SAFE_INTEGER) {
    throw Error("totalActiveStakeByIncrement >= Number.MAX_SAFE_INTEGER. MAX_EFFECTIVE_BALANCE is too low.");
  }

  // SPEC: function getBaseRewardPerIncrement()
  const baseRewardPerIncrement = computeBaseRewardPerIncrement(totalActiveStakeByIncrement);

  // To optimize process_registry_updates():
  // order by sequence of activationEligibilityEpoch setting and then index
  indicesEligibleForActivation.sort(
    (a, b) => validators[a].activationEligibilityEpoch - validators[b].activationEligibilityEpoch || a - b
  );

  if (forkName === ForkName.phase0) {
    statusProcessEpoch(
      state as CachedBeaconStatePhase0,
      statuses,
      (state as CachedBeaconStatePhase0).previousEpochAttestations.getAllReadonly(),
      prevEpoch,
      FLAG_PREV_SOURCE_ATTESTER,
      FLAG_PREV_TARGET_ATTESTER,
      FLAG_PREV_HEAD_ATTESTER
    );
    statusProcessEpoch(
      state as CachedBeaconStatePhase0,
      statuses,
      (state as CachedBeaconStatePhase0).currentEpochAttestations.getAllReadonly(),
      currentEpoch,
      FLAG_CURR_SOURCE_ATTESTER,
      FLAG_CURR_TARGET_ATTESTER,
      FLAG_CURR_HEAD_ATTESTER
    );
  } else {
    const previousEpochParticipation = (state as CachedBeaconStateAltair).previousEpochParticipation.getAll();
    for (let i = 0; i < previousEpochParticipation.length; i++) {
      const status = statuses[i];
      // this is required to pass random spec tests in altair
      if (isActivePrevEpoch[i]) {
        // FLAG_PREV are indexes [0,1,2]
        status.flags |= previousEpochParticipation[i];
      }
    }

    const currentEpochParticipation = (state as CachedBeaconStateAltair).currentEpochParticipation.getAll();
    for (let i = 0; i < currentEpochParticipation.length; i++) {
      const status = statuses[i];
      // this is required to pass random spec tests in altair
      if (status.active) {
        // FLAG_PREV are indexes [3,4,5], so shift by 3
        status.flags |= currentEpochParticipation[i] << 3;
      }
    }
  }

  let prevSourceUnslStake = 0;
  let prevTargetUnslStake = 0;
  let prevHeadUnslStake = 0;

  let currTargetUnslStake = 0;

  const FLAG_PREV_SOURCE_ATTESTER_UNSLASHED = FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED;
  const FLAG_PREV_TARGET_ATTESTER_UNSLASHED = FLAG_PREV_TARGET_ATTESTER | FLAG_UNSLASHED;
  const FLAG_PREV_HEAD_ATTESTER_UNSLASHED = FLAG_PREV_HEAD_ATTESTER | FLAG_UNSLASHED;
  const FLAG_CURR_TARGET_UNSLASHED = FLAG_CURR_TARGET_ATTESTER | FLAG_UNSLASHED;

  for (let i = 0; i < statuses.length; i++) {
    const status = statuses[i];
    const effectiveBalanceByIncrement = effectiveBalancesByIncrements[i];
    if (hasMarkers(status.flags, FLAG_PREV_SOURCE_ATTESTER_UNSLASHED)) {
      prevSourceUnslStake += effectiveBalanceByIncrement;
    }
    if (hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER_UNSLASHED)) {
      prevTargetUnslStake += effectiveBalanceByIncrement;
    }
    if (hasMarkers(status.flags, FLAG_PREV_HEAD_ATTESTER_UNSLASHED)) {
      prevHeadUnslStake += effectiveBalanceByIncrement;
    }
    if (hasMarkers(status.flags, FLAG_CURR_TARGET_UNSLASHED)) {
      currTargetUnslStake += effectiveBalanceByIncrement;
    }
  }
  // As per spec of `get_total_balance`:
  // EFFECTIVE_BALANCE_INCREMENT Gwei minimum to avoid divisions by zero.
  // Math safe up to ~10B ETH, afterwhich this overflows uint64.
  if (prevSourceUnslStake < 1) prevSourceUnslStake = 1;
  if (prevTargetUnslStake < 1) prevTargetUnslStake = 1;
  if (prevHeadUnslStake < 1) prevHeadUnslStake = 1;
  if (currTargetUnslStake < 1) currTargetUnslStake = 1;

  return {
    prevEpoch,
    currentEpoch,
    totalActiveStakeByIncrement,
    baseRewardPerIncrement,
    prevEpochUnslashedStake: {
      sourceStakeByIncrement: prevSourceUnslStake,
      targetStakeByIncrement: prevTargetUnslStake,
      headStakeByIncrement: prevHeadUnslStake,
    },
    currEpochUnslashedTargetStakeByIncrement: currTargetUnslStake,
    eligibleValidatorIndices,
    indicesToSlash,
    indicesEligibleForActivationQueue,
    indicesEligibleForActivation,
    indicesToEject,
    nextEpochShufflingActiveValidatorIndices,
    // to be updated in processEffectiveBalanceUpdates
    nextEpochTotalActiveBalanceByIncrement: 0,
    isActiveNextEpoch,
    statuses,

    // Will be assigned in processRewardsAndPenalties()
    balances: undefined,
  };
}
