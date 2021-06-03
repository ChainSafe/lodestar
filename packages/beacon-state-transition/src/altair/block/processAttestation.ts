import {allForks, altair, Gwei, phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {bigIntSqrt, intSqrt} from "@chainsafe/lodestar-utils";

import {computeEpochAtSlot, getBlockRoot, getBlockRootAtSlot, getTotalActiveBalance, increaseBalance} from "../../util";
import {CachedBeaconState} from "../../allForks/util";
import {isValidIndexedAttestation} from "../../allForks/block";
import {IParticipationStatus} from "../../allForks/util/cachedEpochParticipation";
import {
  PROPOSER_WEIGHT,
  TIMELY_HEAD_WEIGHT,
  TIMELY_SOURCE_WEIGHT,
  TIMELY_TARGET_WEIGHT,
  WEIGHT_DENOMINATOR,
} from "../constants";

export function processAttestation(
  state: CachedBeaconState<altair.BeaconState>,
  attestation: phase0.Attestation,
  verifySignature = true
): void {
  const {config, epochCtx} = state;
  const {MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH} = config.params;
  const slot = state.slot;
  const data = attestation.data;
  const committeeCount = epochCtx.getCommitteeCountAtSlot(data.slot);
  if (!(data.index < committeeCount)) {
    throw new Error(
      "Attestation committee index not within current committee count: " +
        `committeeIndex=${data.index} committeeCount=${committeeCount}`
    );
  }
  if (
    !(data.target.epoch === epochCtx.previousShuffling.epoch || data.target.epoch === epochCtx.currentShuffling.epoch)
  ) {
    throw new Error(
      "Attestation target epoch not in previous or current epoch: " +
        `targetEpoch=${data.target.epoch} currentEpoch=${epochCtx.currentShuffling.epoch}`
    );
  }
  const computedEpoch = computeEpochAtSlot(config, data.slot);
  if (!(data.target.epoch === computedEpoch)) {
    throw new Error(
      "Attestation target epoch does not match epoch computed from slot: " +
        `targetEpoch=${data.target.epoch} computedEpoch=${computedEpoch}`
    );
  }
  if (!(data.slot + MIN_ATTESTATION_INCLUSION_DELAY <= slot && slot <= data.slot + SLOTS_PER_EPOCH)) {
    throw new Error(
      "Attestation slot not within inclusion window: " +
        `slot=${data.slot} window=${data.slot + MIN_ATTESTATION_INCLUSION_DELAY}..${data.slot + SLOTS_PER_EPOCH}`
    );
  }

  const committee = epochCtx.getBeaconCommittee(data.slot, data.index);
  if (attestation.aggregationBits.length !== committee.length) {
    throw new Error(
      "Attestation aggregation bits length does not match committee length: " +
        `aggregationBitsLength=${attestation.aggregationBits.length} committeeLength=${committee.length}`
    );
  }

  let epochParticipation;
  if (data.target.epoch === epochCtx.currentShuffling.epoch) {
    epochParticipation = state.currentEpochParticipation;
  } else {
    epochParticipation = state.previousEpochParticipation;
  }

  // this check is done last because its the most expensive (if signature verification is toggled on)
  if (
    !isValidIndexedAttestation(
      state as CachedBeaconState<allForks.BeaconState>,
      epochCtx.getIndexedAttestation(attestation),
      verifySignature
    )
  ) {
    throw new Error("Attestation is not valid");
  }
  const {timelySource, timelyTarget, timelyHead} = getAttestationParticipationStatus(
    state,
    data,
    state.slot - data.slot
  );

  // Retrieve the validator indices from the attestation participation bitfield
  const attestingIndices = epochCtx.getAttestingIndices(data, attestation.aggregationBits);

  // For each participant, update their participation
  // In epoch processing, this participation info is used to calculate balance updates
  let proposerRewardNumerator = BigInt(0);
  for (const index of attestingIndices) {
    const status = epochParticipation.getStatus(index) as IParticipationStatus;
    const newStatus = {
      timelySource: status.timelySource || timelySource,
      timelyTarget: status.timelyTarget || timelyTarget,
      timelyHead: status.timelyHead || timelyHead,
    };
    epochParticipation.setStatus(index, newStatus);
    // add proposer rewards for source/target/head that updated the state
    proposerRewardNumerator +=
      getBaseReward(state, index) *
      (BigInt(!status.timelySource && timelySource) * TIMELY_SOURCE_WEIGHT +
        BigInt(!status.timelyTarget && timelyTarget) * TIMELY_TARGET_WEIGHT +
        BigInt(!status.timelyHead && timelyHead) * TIMELY_HEAD_WEIGHT);
  }

  const proposerRewardDenominator = ((WEIGHT_DENOMINATOR - PROPOSER_WEIGHT) * WEIGHT_DENOMINATOR) / PROPOSER_WEIGHT;
  const proposerReward = proposerRewardNumerator / proposerRewardDenominator;
  increaseBalance(state, epochCtx.getBeaconProposer(state.slot), proposerReward);
}

/**
 * https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.4/specs/altair/beacon-chain.md#get_attestation_participation_flag_indices
 */
export function getAttestationParticipationStatus(
  state: CachedBeaconState<altair.BeaconState>,
  data: phase0.AttestationData,
  inclusionDelay: number
): IParticipationStatus {
  const {config, epochCtx} = state;
  const {SLOTS_PER_EPOCH, MIN_ATTESTATION_INCLUSION_DELAY} = config.params;
  let justifiedCheckpoint;
  if (data.target.epoch === epochCtx.currentShuffling.epoch) {
    justifiedCheckpoint = state.currentJustifiedCheckpoint;
  } else {
    justifiedCheckpoint = state.previousJustifiedCheckpoint;
  }
  const isMatchingSource = config.types.phase0.Checkpoint.equals(data.source, justifiedCheckpoint);
  if (!isMatchingSource) {
    throw new Error(
      "Attestation source does not equal justified checkpoint: " +
        `source=${JSON.stringify(config.types.phase0.Checkpoint.toJson(data.source))} ` +
        `justifiedCheckpoint=${JSON.stringify(config.types.phase0.Checkpoint.toJson(justifiedCheckpoint))}`
    );
  }
  const isMatchingTarget = config.types.Root.equals(data.target.root, getBlockRoot(config, state, data.target.epoch));
  // a timely head is only be set if the target is _also_ matching
  const isMatchingHead =
    isMatchingTarget && config.types.Root.equals(data.beaconBlockRoot, getBlockRootAtSlot(config, state, data.slot));
  return {
    timelySource: isMatchingSource && inclusionDelay <= intSqrt(SLOTS_PER_EPOCH),
    timelyTarget: isMatchingTarget && inclusionDelay <= SLOTS_PER_EPOCH,
    timelyHead: isMatchingHead && inclusionDelay === MIN_ATTESTATION_INCLUSION_DELAY,
  };
}

/**
 * TODO: NAIVE - EXTREMELY SLOW
 */
export function getBaseReward(state: CachedBeaconState<altair.BeaconState>, index: ValidatorIndex): Gwei {
  const increments = state.validators[index].effectiveBalance / state.config.params.EFFECTIVE_BALANCE_INCREMENT;
  return increments * getBaseRewardPerIncrement(state);
}

/**
 * TODO: NAIVE - EXTREMELY SLOW
 */
export function getBaseRewardPerIncrement(state: CachedBeaconState<altair.BeaconState>): bigint {
  return (
    (state.config.params.EFFECTIVE_BALANCE_INCREMENT * BigInt(state.config.params.BASE_REWARD_FACTOR)) /
    bigIntSqrt(getTotalActiveBalance(state.config, state))
  );
}
