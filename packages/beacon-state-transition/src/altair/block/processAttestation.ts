import {allForks, altair, phase0, ssz} from "@chainsafe/lodestar-types";
import {intSqrt} from "@chainsafe/lodestar-utils";

import {getBlockRoot, getBlockRootAtSlot, increaseBalance, verifySignatureSet} from "../../util";
import {CachedBeaconState} from "../../allForks/util";
import {IParticipationStatus} from "../../allForks/util/cachedEpochParticipation";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  MIN_ATTESTATION_INCLUSION_DELAY,
  PROPOSER_WEIGHT,
  SLOTS_PER_EPOCH,
  TIMELY_HEAD_WEIGHT,
  TIMELY_SOURCE_WEIGHT,
  TIMELY_TARGET_WEIGHT,
  WEIGHT_DENOMINATOR,
} from "@chainsafe/lodestar-params";
import {checkpointToStr, validateAttestation} from "../../phase0/block/processAttestation";
import {BlockProcess} from "../../util/blockProcess";
import {getAttestationWithIndicesSignatureSet} from "../../allForks";

const PROPOSER_REWARD_DOMINATOR = ((WEIGHT_DENOMINATOR - PROPOSER_WEIGHT) * WEIGHT_DENOMINATOR) / PROPOSER_WEIGHT;

export function processAttestations(
  state: CachedBeaconState<altair.BeaconState>,
  attestations: phase0.Attestation[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  blockProcess: BlockProcess,
  verifySignature = true
): void {
  const {epochCtx} = state;
  const stateSlot = state.slot;

  // Process all attestations first and then increase the balance of the proposer once
  let proposerReward = BigInt(0);
  for (const attestation of attestations) {
    const data = attestation.data;

    validateAttestation(state as CachedBeaconState<allForks.BeaconState>, attestation);

    // Retrieve the validator indices from the attestation participation bitfield
    const attestingIndices = epochCtx.getAttestingIndices(data, attestation.aggregationBits);

    // this check is done last because its the most expensive (if signature verification is toggled on)
    // TODO: Why should we verify an indexed attestation that we just created? If it's just for the signature
    // we can verify only that and nothing else.
    if (verifySignature) {
      const sigSet = getAttestationWithIndicesSignatureSet(
        state as CachedBeaconState<allForks.BeaconState>,
        attestation,
        attestingIndices
      );
      if (!verifySignatureSet(sigSet)) {
        throw new Error("Attestation signature is not valid");
      }
    }

    const epochParticipation =
      data.target.epoch === epochCtx.currentShuffling.epoch
        ? state.currentEpochParticipation
        : state.previousEpochParticipation;

    const {timelySource, timelyTarget, timelyHead} = getAttestationParticipationStatus(
      state,
      data,
      stateSlot - data.slot
    );

    // For each participant, update their participation
    // In epoch processing, this participation info is used to calculate balance updates
    let totalBalancesWithWeight = BigInt(0);
    for (const index of attestingIndices) {
      const status = epochParticipation.getStatus(index) as IParticipationStatus;
      const newStatus = {
        timelySource: status.timelySource || timelySource,
        timelyTarget: status.timelyTarget || timelyTarget,
        timelyHead: status.timelyHead || timelyHead,
      };
      epochParticipation.setStatus(index, newStatus);
      /**
       * Spec:
       * baseReward = state.validators[index].effectiveBalance / EFFECTIVE_BALANCE_INCREMENT * baseRewardPerIncrement;
       * proposerRewardNumerator += baseReward * totalWeight
       */
      const totalWeight =
        BigInt(!status.timelySource && timelySource) * TIMELY_SOURCE_WEIGHT +
        BigInt(!status.timelyTarget && timelyTarget) * TIMELY_TARGET_WEIGHT +
        BigInt(!status.timelyHead && timelyHead) * TIMELY_HEAD_WEIGHT;

      if (totalWeight > 0) {
        // TODO: Cache effectiveBalance in a separate array
        // TODO: Consider using number instead of bigint for faster math
        totalBalancesWithWeight += state.validators[index].effectiveBalance * totalWeight;
      }
    }

    const totalIncrements = totalBalancesWithWeight / EFFECTIVE_BALANCE_INCREMENT;
    const proposerRewardNumerator = totalIncrements * state.baseRewardPerIncrement;
    proposerReward += proposerRewardNumerator / PROPOSER_REWARD_DOMINATOR;
  }

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
      `Attestation source does not equal justified checkpoint: source=${checkpointToStr(
        data.source
      )} justifiedCheckpoint=${checkpointToStr(justifiedCheckpoint)}`
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
