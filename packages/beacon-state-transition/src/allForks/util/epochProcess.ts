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

export function createIEpochProcess(): IEpochProcess {
  return {
    prevEpoch: 0,
    currentEpoch: 0,
    totalActiveStake: BigInt(0),
    baseRewardPerIncrement: BigInt(0),
    prevEpochUnslashedStake: {
      sourceStake: BigInt(0),
      targetStake: BigInt(0),
      headStake: BigInt(0),
    },
    currEpochUnslashedTargetStake: BigInt(0),
    indicesToSlash: [],
    indicesEligibleForActivationQueue: [],
    indicesEligibleForActivation: [],
    indicesToEject: [],
    statuses: [],
    validators: [],
    nextEpochActiveValidatorIndices: [],
  };
}

export function beforeProcessEpoch<T extends allForks.BeaconState>(state: CachedBeaconState<T>): IEpochProcess {
  const out = createIEpochProcess();

  const {config, epochCtx, validators} = state;
  const forkName = config.getForkName(state.slot);
  const currentEpoch = epochCtx.currentShuffling.epoch;
  const prevEpoch = epochCtx.previousShuffling.epoch;
  const nextEpoch = currentEpoch + 1;
  out.currentEpoch = currentEpoch;
  out.prevEpoch = prevEpoch;

  const slashingsEpoch = currentEpoch + intDiv(EPOCHS_PER_SLASHINGS_VECTOR, 2);

  out.validators = validators.persistent.toArray();
  out.validators.forEach((v, i) => {
    const status = createIAttesterStatus();

    if (v.slashed) {
      if (slashingsEpoch === v.withdrawableEpoch) {
        out.indicesToSlash.push(i);
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
      out.totalActiveStake += v.effectiveBalance;
    }

    if (v.activationEligibilityEpoch === FAR_FUTURE_EPOCH && v.effectiveBalance === MAX_EFFECTIVE_BALANCE) {
      out.indicesEligibleForActivationQueue.push(i);
    }

    if (v.activationEpoch === FAR_FUTURE_EPOCH && v.activationEligibilityEpoch <= currentEpoch) {
      out.indicesEligibleForActivation.push(i);
    }

    if (status.active && v.exitEpoch === FAR_FUTURE_EPOCH && v.effectiveBalance <= config.EJECTION_BALANCE) {
      out.indicesToEject.push(i);
    }

    out.statuses.push(status);
    if (isActiveValidator(v, nextEpoch)) {
      out.nextEpochActiveValidatorIndices.push(i);
    }
  });

  if (out.totalActiveStake < EFFECTIVE_BALANCE_INCREMENT) {
    out.totalActiveStake = EFFECTIVE_BALANCE_INCREMENT;
  }

  // SPEC: function getBaseRewardPerIncrement()
  out.baseRewardPerIncrement = computeBaseRewardPerIncrement(out.totalActiveStake);

  // order by sequence of activationEligibilityEpoch setting and then index
  out.indicesEligibleForActivation.sort(
    (a, b) => out.validators[a].activationEligibilityEpoch - out.validators[b].activationEligibilityEpoch || a - b
  );

  if (forkName === ForkName.phase0) {
    statusProcessEpoch(
      state,
      out.statuses,
      ((state as unknown) as CachedBeaconState<phase0.BeaconState>).previousEpochAttestations,
      prevEpoch,
      FLAG_PREV_SOURCE_ATTESTER,
      FLAG_PREV_TARGET_ATTESTER,
      FLAG_PREV_HEAD_ATTESTER
    );
    statusProcessEpoch(
      state,
      out.statuses,
      ((state as unknown) as CachedBeaconState<phase0.BeaconState>).currentEpochAttestations,
      currentEpoch,
      FLAG_CURR_SOURCE_ATTESTER,
      FLAG_CURR_TARGET_ATTESTER,
      FLAG_CURR_HEAD_ATTESTER
    );
  } else {
    state.previousEpochParticipation.forEachStatus((status, i) => {
      out.statuses[i].flags |=
        ((status.timelySource && FLAG_PREV_SOURCE_ATTESTER) as number) |
        ((status.timelyTarget && FLAG_PREV_TARGET_ATTESTER) as number) |
        ((status.timelyHead && FLAG_PREV_HEAD_ATTESTER) as number);
    });
    state.currentEpochParticipation.forEachStatus((status, i) => {
      out.statuses[i].flags |=
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

  for (let i = 0; i < out.statuses.length; i++) {
    const status = out.statuses[i];
    const effectiveBalance = out.validators[i].effectiveBalance;
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

  out.prevEpochUnslashedStake.sourceStake = prevSourceUnslStake;
  out.prevEpochUnslashedStake.targetStake = prevTargetUnslStake;
  out.prevEpochUnslashedStake.headStake = prevHeadUnslStake;
  out.currEpochUnslashedTargetStake = currTargetUnslStake;

  return out;
}
