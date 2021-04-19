import {Epoch, ValidatorIndex, Gwei, allForks, phase0} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";

import {computeActivationExitEpoch, getChurnLimit, isActiveValidator} from "../../util";
import {FAR_FUTURE_EPOCH} from "../../constants";
import {IEpochStakeSummary} from "./epochStakeSummary";
import {CachedBeaconState} from "./cachedBeaconState";
import {IParticipationStatus} from "./cachedEpochParticipation";

/**
 * The AttesterStatus (and FlatValidator under status.validator) objects and
 * EpochStakeSummary are tracked in the IEpochProcess and made available as additional context in the
 * epoch transition.
 */
export interface IEpochProcess {
  prevEpoch: Epoch;
  currentEpoch: Epoch;
  totalActiveStake: Gwei;
  prevEpochUnslashedStake: IEpochStakeSummary;
  currEpochUnslashedTargetStake: Gwei;
  indicesToSlash: ValidatorIndex[];
  indicesToSetActivationEligibility: ValidatorIndex[];
  // ignores churn, apply churn-limit manually.
  // maybe, because finality affects it still
  indicesToMaybeActivate: ValidatorIndex[];

  indicesToEject: ValidatorIndex[];
  exitQueueEnd: Epoch;
  exitQueueEndChurn: number;
  churnLimit: number;
  validators?: phase0.Validator[];
  previousEpochParticipation?: IParticipationStatus[];
  currentEpochParticipation?: IParticipationStatus[];
  balances?: ArrayLike<bigint>;
}

export function createIEpochProcess(): IEpochProcess {
  return {
    prevEpoch: 0,
    currentEpoch: 0,
    totalActiveStake: BigInt(0),
    prevEpochUnslashedStake: {
      sourceStake: BigInt(0),
      targetStake: BigInt(0),
      headStake: BigInt(0),
    },
    currEpochUnslashedTargetStake: BigInt(0),
    indicesToSlash: [],
    indicesToSetActivationEligibility: [],
    indicesToMaybeActivate: [],
    indicesToEject: [],
    exitQueueEnd: 0,
    exitQueueEndChurn: 0,
    churnLimit: 0,
  };
}

export function prepareEpochProcessState<T extends allForks.BeaconState>(state: CachedBeaconState<T>): IEpochProcess {
  const out = createIEpochProcess();

  const {config, epochCtx, validators, previousEpochParticipation, currentEpochParticipation} = state;
  const {
    EPOCHS_PER_SLASHINGS_VECTOR,
    MAX_EFFECTIVE_BALANCE,
    EFFECTIVE_BALANCE_INCREMENT,
    EJECTION_BALANCE,
  } = config.params;
  const currentEpoch = epochCtx.currentShuffling.epoch;
  const prevEpoch = epochCtx.previousShuffling.epoch;
  out.currentEpoch = currentEpoch;
  out.prevEpoch = prevEpoch;

  const slashingsEpoch = currentEpoch + intDiv(EPOCHS_PER_SLASHINGS_VECTOR, 2);
  let exitQueueEnd = computeActivationExitEpoch(config, currentEpoch);

  let activeCount = 0;

  const indicesAndValidatorsToMaybeActivate: [number, T["validators"][number]][] = [];
  let exitQueueEndChurn = 0;

  let prevSourceUnslStake = BigInt(0);
  let prevTargetUnslStake = BigInt(0);
  let prevHeadUnslStake = BigInt(0);

  let currTargetUnslStake = BigInt(0);

  const flatValidators = (out.validators = validators.persistent.toArray());
  const flatPreviousEpochParticipation = (out.previousEpochParticipation = previousEpochParticipation.persistent.toArray());
  const flatCurrentEpochParticipation = (out.currentEpochParticipation = currentEpochParticipation.persistent.toArray());
  for (let i = 0; i < flatValidators.length; i++) {
    const validator = flatValidators[i];
    const previousParticipation = flatPreviousEpochParticipation[i];
    const currentParticipation = flatCurrentEpochParticipation[i];

    if (validator.slashed) {
      if (slashingsEpoch === validator.withdrawableEpoch) {
        out.indicesToSlash.push(i);
      }
    }

    const active = isActiveValidator(validator, currentEpoch);
    if (active) {
      out.totalActiveStake += validator.effectiveBalance;
      activeCount += 1;
    }

    if (validator.exitEpoch !== FAR_FUTURE_EPOCH && validator.exitEpoch > exitQueueEnd) {
      exitQueueEnd = validator.exitEpoch;
    }

    if (
      validator.activationEligibilityEpoch === FAR_FUTURE_EPOCH &&
      validator.effectiveBalance === MAX_EFFECTIVE_BALANCE
    ) {
      out.indicesToSetActivationEligibility.push(i);
    }

    if (validator.activationEpoch === FAR_FUTURE_EPOCH && validator.activationEligibilityEpoch <= currentEpoch) {
      indicesAndValidatorsToMaybeActivate.push([i, validator]);
    }

    if (active && validator.exitEpoch === FAR_FUTURE_EPOCH && validator.effectiveBalance <= EJECTION_BALANCE) {
      out.indicesToEject.push(i);
    }

    if (validator.exitEpoch === exitQueueEnd) {
      exitQueueEndChurn += 1;
    }

    if (!validator.slashed) {
      if (previousParticipation.timelySource) {
        prevSourceUnslStake += validator.effectiveBalance;
        if (previousParticipation.timelyTarget) {
          prevTargetUnslStake += validator.effectiveBalance;
          if (previousParticipation.timelyHead) {
            prevHeadUnslStake += validator.effectiveBalance;
          }
        }
      }
      if (currentParticipation.timelyTarget) {
        currTargetUnslStake += validator.effectiveBalance;
      }
    }
  }

  if (out.totalActiveStake < EFFECTIVE_BALANCE_INCREMENT) {
    out.totalActiveStake = EFFECTIVE_BALANCE_INCREMENT;
  }

  out.indicesToMaybeActivate = indicesAndValidatorsToMaybeActivate
    // order by activationEligibilityEpoch, then validator index
    .sort((a, b) => a[1].activationEligibilityEpoch - b[1].activationEligibilityEpoch || a[0] - b[0])
    .map((i) => i[0]);

  const churnLimit = getChurnLimit(config, activeCount);
  if (exitQueueEndChurn >= churnLimit) {
    exitQueueEnd += 1;
    exitQueueEndChurn = 0;
  }

  out.exitQueueEndChurn = exitQueueEndChurn;
  out.exitQueueEnd = exitQueueEnd;
  out.churnLimit = churnLimit;

  // As per spec of `get_total_balance`:
  // EFFECTIVE_BALANCE_INCREMENT Gwei minimum to avoid divisions by zero.
  // Math safe up to ~10B ETH, afterwhich this overflows uint64.
  const increment = config.params.EFFECTIVE_BALANCE_INCREMENT;
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
