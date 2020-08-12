import {List, readOnlyForEach, readOnlyMap} from "@chainsafe/ssz";
import {Epoch, ValidatorIndex, Gwei, BeaconState, PendingAttestation} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";

import {computeActivationExitEpoch, getBlockRootAtSlot, computeStartSlotAtEpoch, getChurnLimit} from "../../util";
import {FAR_FUTURE_EPOCH} from "../../constants";
import {
  IAttesterStatus, createIAttesterStatus, hasMarkers,
  FLAG_UNSLASHED, FLAG_ELIGIBLE_ATTESTER,
  FLAG_PREV_SOURCE_ATTESTER, FLAG_PREV_TARGET_ATTESTER, FLAG_PREV_HEAD_ATTESTER,
  FLAG_CURR_SOURCE_ATTESTER, FLAG_CURR_TARGET_ATTESTER, FLAG_CURR_HEAD_ATTESTER,
} from "./attesterStatus";
import {IEpochStakeSummary} from "./epochStakeSummary";
import {EpochContext} from "./epochContext";
import {createIFlatValidator, isActiveIFlatValidator} from "./flatValidator";

export interface IEpochProcess {
  prevEpoch: Epoch;
  currentEpoch: Epoch;
  statuses: IAttesterStatus[];
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
}

export function createIEpochProcess(): IEpochProcess {
  return {
    prevEpoch: 0,
    currentEpoch: 0,
    statuses: [],
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

export function prepareEpochProcessState(epochCtx: EpochContext, state: BeaconState): IEpochProcess {
  const out = createIEpochProcess();

  const config = epochCtx.config;
  const Root = config.types.Root;
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
  readOnlyForEach(state.validators, (validator, i) => {
    const v = createIFlatValidator(validator);
    const status = createIAttesterStatus(v);

    if (v.slashed) {
      if (slashingsEpoch === v.withdrawableEpoch) {
        out.indicesToSlash.push(i);
      }
    } else {
      status.flags |= FLAG_UNSLASHED;
    }

    if (isActiveIFlatValidator(v, prevEpoch) || (v.slashed && (prevEpoch + 1 < v.withdrawableEpoch))) {
      status.flags |= FLAG_ELIGIBLE_ATTESTER;
    }

    const active = isActiveIFlatValidator(v, currentEpoch);
    if (active) {
      status.active = true;
      out.totalActiveStake += v.effectiveBalance;
      activeCount += 1;
    }

    if (
      v.exitEpoch !== FAR_FUTURE_EPOCH &&
      v.exitEpoch > exitQueueEnd
    ) {
      exitQueueEnd = v.exitEpoch;
    }

    if (
      v.activationEligibilityEpoch === FAR_FUTURE_EPOCH &&
      v.effectiveBalance === MAX_EFFECTIVE_BALANCE
    ) {
      out.indicesToSetActivationEligibility.push(i);
    }

    if (
      v.activationEpoch === FAR_FUTURE_EPOCH &&
      v.activationEligibilityEpoch <= currentEpoch
    ) {
      out.indicesToMaybeActivate.push(i);
    }

    if (
      status.active &&
      v.exitEpoch === FAR_FUTURE_EPOCH &&
      v.effectiveBalance <= EJECTION_BALANCE
    ) {
      out.indicesToEject.push(i);
    }

    out.statuses.push(status);
  });

  if (out.totalActiveStake < EFFECTIVE_BALANCE_INCREMENT) {
    out.totalActiveStake = EFFECTIVE_BALANCE_INCREMENT;
  }

  // order by sequence of activationEligibilityEpoch setting and then index
  out.indicesToMaybeActivate.sort((a, b) => (
    (out.statuses[a].validator.activationEligibilityEpoch - out.statuses[b].validator.activationEligibilityEpoch) ||
    a - b
  ));

  let exitQueueEndChurn = 0;
  out.statuses.forEach((status) => {
    if (status.validator.exitEpoch === exitQueueEnd) {
      exitQueueEndChurn += 1;
    }
  });

  const churnLimit = getChurnLimit(config, activeCount);
  if (exitQueueEndChurn >= churnLimit) {
    exitQueueEnd += 1;
    exitQueueEndChurn = 0;
  }

  out.exitQueueEndChurn = exitQueueEndChurn;
  out.exitQueueEnd = exitQueueEnd;
  out.churnLimit = churnLimit;

  const statusProcessEpoch = (
    statuses: IAttesterStatus[],
    attestations: List<PendingAttestation>,
    epoch: Epoch,
    sourceFlag: number, targetFlag: number, headFlag: number,
  ): void => {
    const actualTargetBlockRoot = getBlockRootAtSlot(config, state, computeStartSlotAtEpoch(config, epoch));
    readOnlyForEach(attestations, (att) => {
      // Load all the attestation details from the state tree once, do not reload for each participant
      const aggregationBits = att.aggregationBits;
      const attData = att.data;
      const inclusionDelay = att.inclusionDelay;
      const proposerIndex = att.proposerIndex;
      const attSlot = attData.slot;
      const committeeIndex = attData.index;
      const attBeaconBlockRoot = attData.beaconBlockRoot;
      const attTarget = attData.target;

      const attBits = readOnlyMap(aggregationBits, (b) => b);
      const attVotedTargetRoot = Root.equals(attTarget.root, actualTargetBlockRoot);
      const attVotedHeadRoot = Root.equals(attBeaconBlockRoot, getBlockRootAtSlot(config, state, attSlot));

      // attestation-target is already known to be this epoch, get it from the pre-computed shuffling directly.
      const committee = epochCtx.getBeaconCommittee(attSlot, committeeIndex);

      const participants: ValidatorIndex[] = [];
      committee.forEach((index, i) => {
        if (attBits[i]) {
          participants.push(index);
        }
      });

      if (epoch === prevEpoch) {
        participants.forEach((p) => {
          const status = statuses[p];

          // If the attestation is the earliest, i.e. has the smallest delay
          if (status.proposerIndex === -1 || status.inclusionDelay > inclusionDelay) {
            status.proposerIndex = proposerIndex;
            status.inclusionDelay = inclusionDelay;
          }
        });
      }

      participants.forEach((p) => {
        const status = statuses[p];

        // remember the participant as one of the good validators
        status.flags |= sourceFlag;

        // if the attestation is for the boundary
        if (attVotedTargetRoot) {
          status.flags |= targetFlag;

          // head votes must be a subset of target votes
          if (attVotedHeadRoot) {
            status.flags |= headFlag;
          }
        }
      });
    });
  };
  statusProcessEpoch(
    out.statuses, state.previousEpochAttestations, prevEpoch,
    FLAG_PREV_SOURCE_ATTESTER, FLAG_PREV_TARGET_ATTESTER, FLAG_PREV_HEAD_ATTESTER,
  );
  statusProcessEpoch(
    out.statuses, state.currentEpochAttestations, currentEpoch,
    FLAG_CURR_SOURCE_ATTESTER, FLAG_CURR_TARGET_ATTESTER, FLAG_CURR_HEAD_ATTESTER,
  );

  let prevSourceUnslStake = BigInt(0);
  let prevTargetUnslStake = BigInt(0);
  let prevHeadUnslStake = BigInt(0);

  let currTargetUnslStake = BigInt(0);

  out.statuses.forEach((status) => {
    if (hasMarkers(status.flags, FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED)) {
      prevSourceUnslStake += status.validator.effectiveBalance;
      if (hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER)) {
        prevTargetUnslStake += status.validator.effectiveBalance;
        if (hasMarkers(status.flags, FLAG_PREV_HEAD_ATTESTER)) {
          prevHeadUnslStake += status.validator.effectiveBalance;
        }
      }
    }
    if (hasMarkers(status.flags, FLAG_CURR_TARGET_ATTESTER | FLAG_UNSLASHED)) {
      currTargetUnslStake += status.validator.effectiveBalance;
    }
  });
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
