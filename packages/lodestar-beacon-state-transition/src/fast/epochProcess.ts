import {Epoch, ValidatorIndex, Gwei, BeaconState, PendingAttestation} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";

import {IAttesterStatus, createIAttesterStatus, FLAG_UNSLASHED, FLAG_ELIGIBLE_ATTESTER, FLAG_PREV_SOURCE_ATTESTER, FLAG_PREV_TARGET_ATTESTER, FLAG_PREV_HEAD_ATTESTER, hasMarkers, FLAG_CURR_SOURCE_ATTESTER, FLAG_CURR_TARGET_ATTESTER, FLAG_CURR_HEAD_ATTESTER} from "./attesterStatus";
import {IEpochStakeSummary} from "./epochStakeSummary";
import {EpochContext} from "./epochContext";
import { computeActivationExitEpoch, getBlockRootAtSlot, computeStartSlotAtEpoch } from "../util";
import { createIFlatValidator, isActiveIFlatValidator } from "./flatValidator";
import { FAR_FUTURE_EPOCH } from "../constants";
import { IBeaconConfig } from "@chainsafe/lodestar-config";
import { List } from "@chainsafe/ssz";

export function getChurnLimit(config: IBeaconConfig, activeValidatorCount: number): number {
  return Math.max(
    config.params.MIN_PER_EPOCH_CHURN_LIMIT,
    intDiv(activeValidatorCount, config.params.CHURN_LIMIT_QUOTIENT),
  );
}

export interface IEpochProcess {
  prevEpoch: Epoch;
  currentEpoch: Epoch;
  statuses: IAttesterStatus[];
  totalActiveStake: Gwei;
  prevEpochUnslashedStake: IEpochStakeSummary;
  prevEpochTargetStake: Gwei;
  currEpochTargetStake: Gwei;
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
    prevEpochTargetStake: BigInt(0),
    currEpochTargetStake: BigInt(0),
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
  const currentEpoch = epochCtx.currentShuffling.epoch;
  const prevEpoch = epochCtx.previousShuffling.epoch;
  out.currentEpoch = currentEpoch;
  out.prevEpoch = prevEpoch;

  const slashingsEpoch = currentEpoch + intDiv(config.params.EPOCHS_PER_SLASHINGS_VECTOR, 2);
  let exitQueueEnd = computeActivationExitEpoch(config, currentEpoch);

  let activeCount = 0;
  // TODO fast read-only iteration here
  state.validators.forEach((validator, i) => {
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
      v.effectiveBalance === config.params.MAX_EFFECTIVE_BALANCE
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
      v.effectiveBalance <= config.params.EJECTION_BALANCE
    ) {
      out.indicesToEject.push(i);
    }

    out.statuses.push(status);
  });

  if (out.totalActiveStake < config.params.EFFECTIVE_BALANCE_INCREMENT) {
    out.totalActiveStake = config.params.EFFECTIVE_BALANCE_INCREMENT;
  }

  // order by sequence of activationEligibilityEpoch setting and then index
  out.indicesToMaybeActivate.sort((a, b) => (
    (out.statuses[a].validator.activationEligibilityEpoch - out.statuses[b].validator.activationEligibilityEpoch) |
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
    attestations.forEach((att) => {
      // Load all the attestation details from the state tree once, do not reload for each participant
      const aggregationBits = att.aggregationBits;
      const attData = att.data;
      const inclusionDelay = att.inclusionDelay;
      const proposerIndex = att.proposerIndex;
      const attSlot = attData.slot;
      const committeeIndex = attData.index;
      const attBeaconBlockRoot = attData.beaconBlockRoot;
      const attTarget = attData.target;

      const attBits = Array.from(aggregationBits);
      const attVotedTargetRoot = attTarget.root === actualTargetBlockRoot;
      const attVotedHeadRoot = attBeaconBlockRoot === getBlockRootAtSlot(config, state, attSlot);

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
  // TODO fast read-only iteration here
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

  let prevTargetStake = BigInt(0);
  let currTargetStake = BigInt(0);

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
    if (hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER)) {
      prevTargetStake += status.validator.effectiveBalance;
    }
    if (hasMarkers(status.flags, FLAG_CURR_TARGET_ATTESTER)) {
      currTargetStake += status.validator.effectiveBalance;
    }
  });

  out.prevEpochUnslashedStake.sourceStake = prevSourceUnslStake;
  out.prevEpochUnslashedStake.targetStake = prevTargetUnslStake;
  out.prevEpochUnslashedStake.headStake = prevHeadUnslStake;
  out.prevEpochTargetStake = prevTargetStake;
  out.currEpochTargetStake = currTargetStake;

  return out;
}
