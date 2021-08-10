import {Epoch, ValidatorIndex, Gwei, phase0, allForks} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  EPOCHS_PER_SLASHINGS_VECTOR,
  FAR_FUTURE_EPOCH,
  ForkName,
  MAX_EFFECTIVE_BALANCE,
} from "@chainsafe/lodestar-params";

import {isActiveValidator} from "../../util";
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
} from "./attesterStatus";
import {IEpochStakeSummary} from "./epochStakeSummary";
import {CachedBeaconState} from "./cachedBeaconState";
import {statusProcessEpoch} from "../../phase0/epoch/processPendingAttestations";
import {computeBaseRewardPerIncrement} from "../../altair/misc";

/**
 * Pre-computed disposable data to process epoch transitions faster at the cost of more memory.
 *
 * The AttesterStatus (and FlatValidator under status.validator) objects and
 * EpochStakeSummary are tracked in the IEpochProcess and made available as additional context in the
 * epoch transition.
 */
export interface IEpochProcess {
  prevEpoch: Epoch;
  currentEpoch: Epoch;
  totalActiveStake: Gwei;
  /** For altair */
  baseRewardPerIncrement: Gwei;
  prevEpochUnslashedStake: IEpochStakeSummary;
  currEpochUnslashedTargetStake: Gwei;
  indicesToSlash: ValidatorIndex[];
  indicesEligibleForActivationQueue: ValidatorIndex[];
  // ignores churn, apply churn-limit manually.
  // maybe, because finality affects it still
  indicesEligibleForActivation: ValidatorIndex[];

  indicesToEject: ValidatorIndex[];

  statuses: IAttesterStatus[];
  validators: phase0.Validator[];
  balances?: BigUint64Array;
  // to be used for afterProcessEpoch()
  nextEpochActiveValidatorIndices: ValidatorIndex[];
}

export function beforeProcessEpoch<T extends allForks.BeaconState>(state: CachedBeaconState<T>): IEpochProcess {
  const {config, epochCtx} = state;
  const forkName = config.getForkName(state.slot);
  const currentEpoch = epochCtx.currentShuffling.epoch;
  const prevEpoch = epochCtx.previousShuffling.epoch;
  const nextEpoch = currentEpoch + 1;

  const slashingsEpoch = currentEpoch + intDiv(EPOCHS_PER_SLASHINGS_VECTOR, 2);

  const indicesToSlash: ValidatorIndex[] = [];
  const indicesEligibleForActivationQueue: ValidatorIndex[] = [];
  const indicesEligibleForActivation: ValidatorIndex[] = [];
  const indicesToEject: ValidatorIndex[] = [];
  const nextEpochActiveValidatorIndices: ValidatorIndex[] = [];

  const statuses: IAttesterStatus[] = [];

  let totalActiveStake = BigInt(0);

  const validators = state.validators.persistent.toArray();
  validators.forEach((v, i) => {
    const status = createIAttesterStatus();

    if (v.slashed) {
      if (slashingsEpoch === v.withdrawableEpoch) {
        indicesToSlash.push(i);
      }
    } else {
      status.flags |= FLAG_UNSLASHED;
    }

    if (isActiveValidator(v, prevEpoch) || (v.slashed && prevEpoch + 1 < v.withdrawableEpoch)) {
      status.flags |= FLAG_ELIGIBLE_ATTESTER;
    }

    const active = isActiveValidator(v, currentEpoch);
    if (active) {
      status.active = true;
      totalActiveStake += v.effectiveBalance;
    }

    if (v.activationEligibilityEpoch === FAR_FUTURE_EPOCH && v.effectiveBalance === MAX_EFFECTIVE_BALANCE) {
      indicesEligibleForActivationQueue.push(i);
    }

    if (v.activationEpoch === FAR_FUTURE_EPOCH && v.activationEligibilityEpoch <= currentEpoch) {
      indicesEligibleForActivation.push(i);
    }

    if (status.active && v.exitEpoch === FAR_FUTURE_EPOCH && v.effectiveBalance <= config.EJECTION_BALANCE) {
      indicesToEject.push(i);
    }

    statuses.push(status);
    if (isActiveValidator(v, nextEpoch)) {
      nextEpochActiveValidatorIndices.push(i);
    }
  });

  if (totalActiveStake < EFFECTIVE_BALANCE_INCREMENT) {
    totalActiveStake = EFFECTIVE_BALANCE_INCREMENT;
  }

  // SPEC: function getBaseRewardPerIncrement()
  const baseRewardPerIncrement = computeBaseRewardPerIncrement(totalActiveStake);

  // order by sequence of activationEligibilityEpoch setting and then index
  indicesEligibleForActivation.sort(
    (a, b) => validators[a].activationEligibilityEpoch - validators[b].activationEligibilityEpoch || a - b
  );

  if (forkName === ForkName.phase0) {
    statusProcessEpoch(
      state,
      statuses,
      ((state as unknown) as CachedBeaconState<phase0.BeaconState>).previousEpochAttestations,
      prevEpoch,
      FLAG_PREV_SOURCE_ATTESTER,
      FLAG_PREV_TARGET_ATTESTER,
      FLAG_PREV_HEAD_ATTESTER
    );
    statusProcessEpoch(
      state,
      statuses,
      ((state as unknown) as CachedBeaconState<phase0.BeaconState>).currentEpochAttestations,
      currentEpoch,
      FLAG_CURR_SOURCE_ATTESTER,
      FLAG_CURR_TARGET_ATTESTER,
      FLAG_CURR_HEAD_ATTESTER
    );
  } else {
    state.previousEpochParticipation.forEachStatus((status, i) => {
      statuses[i].flags |=
        ((status.timelySource && FLAG_PREV_SOURCE_ATTESTER) as number) |
        ((status.timelyTarget && FLAG_PREV_TARGET_ATTESTER) as number) |
        ((status.timelyHead && FLAG_PREV_HEAD_ATTESTER) as number);
    });
    state.currentEpochParticipation.forEachStatus((status, i) => {
      statuses[i].flags |=
        ((status.timelySource && FLAG_CURR_SOURCE_ATTESTER) as number) |
        ((status.timelyTarget && FLAG_CURR_TARGET_ATTESTER) as number) |
        ((status.timelyHead && FLAG_CURR_HEAD_ATTESTER) as number);
    });
  }

  let prevSourceUnslStake = BigInt(0);
  let prevTargetUnslStake = BigInt(0);
  let prevHeadUnslStake = BigInt(0);

  let currTargetUnslStake = BigInt(0);

  const FLAG_PREV_SOURCE_ATTESTER_UNSLASHED = FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED;
  const FLAG_PREV_TARGET_ATTESTER_UNSLASHED = FLAG_PREV_TARGET_ATTESTER | FLAG_UNSLASHED;
  const FLAG_PREV_HEAD_ATTESTER_UNSLASHED = FLAG_PREV_HEAD_ATTESTER | FLAG_UNSLASHED;
  const FLAG_CURR_TARGET_UNSLASHED = FLAG_CURR_TARGET_ATTESTER | FLAG_UNSLASHED;

  for (let i = 0; i < statuses.length; i++) {
    const status = statuses[i];
    const effectiveBalance = validators[i].effectiveBalance;
    if (hasMarkers(status.flags, FLAG_PREV_SOURCE_ATTESTER_UNSLASHED)) {
      prevSourceUnslStake += effectiveBalance;
    }
    if (hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER_UNSLASHED)) {
      prevTargetUnslStake += effectiveBalance;
    }
    if (hasMarkers(status.flags, FLAG_PREV_HEAD_ATTESTER_UNSLASHED)) {
      prevHeadUnslStake += effectiveBalance;
    }
    if (hasMarkers(status.flags, FLAG_CURR_TARGET_UNSLASHED)) {
      currTargetUnslStake += effectiveBalance;
    }
  }
  // As per spec of `get_total_balance`:
  // EFFECTIVE_BALANCE_INCREMENT Gwei minimum to avoid divisions by zero.
  // Math safe up to ~10B ETH, afterwhich this overflows uint64.
  const increment = EFFECTIVE_BALANCE_INCREMENT;
  if (prevSourceUnslStake < increment) prevSourceUnslStake = increment;
  if (prevTargetUnslStake < increment) prevTargetUnslStake = increment;
  if (prevHeadUnslStake < increment) prevHeadUnslStake = increment;
  if (currTargetUnslStake < increment) currTargetUnslStake = increment;

  return {
    prevEpoch,
    currentEpoch,
    totalActiveStake,

    baseRewardPerIncrement,
    prevEpochUnslashedStake: {
      sourceStake: prevSourceUnslStake,
      targetStake: prevTargetUnslStake,
      headStake: prevHeadUnslStake,
    },
    currEpochUnslashedTargetStake: currTargetUnslStake,
    indicesToSlash,
    indicesEligibleForActivationQueue,
    indicesEligibleForActivation,
    indicesToEject,
    nextEpochActiveValidatorIndices,

    statuses,
    validators,
  };
}
