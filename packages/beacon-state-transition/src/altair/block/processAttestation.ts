import {allForks, altair, phase0, ssz} from "@chainsafe/lodestar-types";
import {
  MIN_ATTESTATION_INCLUSION_DELAY,
  PROPOSER_WEIGHT,
  SLOTS_PER_EPOCH,
  TIMELY_HEAD_WEIGHT,
  TIMELY_SOURCE_WEIGHT,
  TIMELY_TARGET_WEIGHT,
  WEIGHT_DENOMINATOR,
} from "@chainsafe/lodestar-params";

import {computeEpochAtSlot, getBlockRoot, getBlockRootAtSlot, increaseBalance} from "../../util";
import {CachedBeaconState} from "../../allForks/util";
import {isValidIndexedAttestation} from "../../allForks/block";
import {IParticipationStatus} from "../../allForks/util/cachedEpochParticipation";
import {getBaseReward} from "../state_accessor";
import {intSqrt} from "@chainsafe/lodestar-utils";

export function processAttestation(
  state: CachedBeaconState<altair.BeaconState>,
  attestation: phase0.Attestation,
  verifySignature = true
): void {
  const {epochCtx} = state;
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
  const computedEpoch = computeEpochAtSlot(data.slot);
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
  const {epochCtx} = state;
  let justifiedCheckpoint;
  if (data.target.epoch === epochCtx.currentShuffling.epoch) {
    justifiedCheckpoint = state.currentJustifiedCheckpoint;
  } else {
    justifiedCheckpoint = state.previousJustifiedCheckpoint;
  }
  // The source and target votes are part of the FFG vote, the head vote is part of the fork choice vote
  // Both are tracked to properly incentivise validators
  //
  // The source vote always matches the justified checkpoint (else its invalid)
  // The target vote should match the most recent checkpoint (eg: the first root of the epoch)
  // The head vote should match the root at the attestation slot (eg: the root at data.slot)
  const isMatchingSource = ssz.phase0.Checkpoint.equals(data.source, justifiedCheckpoint);
  if (!isMatchingSource) {
    throw new Error(
      "Attestation source does not equal justified checkpoint: " +
        `source=${JSON.stringify(ssz.phase0.Checkpoint.toJson(data.source))} ` +
        `justifiedCheckpoint=${JSON.stringify(ssz.phase0.Checkpoint.toJson(justifiedCheckpoint))}`
    );
  }
  const isMatchingTarget = ssz.Root.equals(data.target.root, getBlockRoot(state, data.target.epoch));
  // a timely head is only be set if the target is _also_ matching
  const isMatchingHead =
    isMatchingTarget && ssz.Root.equals(data.beaconBlockRoot, getBlockRootAtSlot(state, data.slot));
  return {
    timelySource: isMatchingSource && inclusionDelay <= intSqrt(SLOTS_PER_EPOCH),
    timelyTarget: isMatchingTarget && inclusionDelay <= SLOTS_PER_EPOCH,
    timelyHead: isMatchingHead && inclusionDelay === MIN_ATTESTATION_INCLUSION_DELAY,
  };
}
