import {toRootHex} from "@lodestar/utils";
import {Slot, Attestation, electra, phase0, ssz} from "@lodestar/types";
import {MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH, ForkSeq} from "@lodestar/params";
import {assert} from "@lodestar/utils";
import {computeEpochAtSlot} from "../util/index.js";
import {CachedBeaconStatePhase0, CachedBeaconStateAllForks} from "../types.js";
import {isValidIndexedAttestation} from "./index.js";

/**
 * Process an Attestation operation. Validates an attestation and appends it to state.currentEpochAttestations or
 * state.previousEpochAttestations to be processed in bulk at the epoch transition.
 *
 * PERF: Work depends on number of Attestation per block. On mainnet the average is 89.7 / block, with 87.8 participant
 * true bits on average. See `packages/state-transition/test/perf/analyzeBlocks.ts`
 */
export function processAttestationPhase0(
  state: CachedBeaconStatePhase0,
  attestation: phase0.Attestation,
  verifySignature = true
): void {
  const {epochCtx} = state;
  const slot = state.slot;
  const data = attestation.data;

  validateAttestation(ForkSeq.phase0, state, attestation);

  const pendingAttestation = ssz.phase0.PendingAttestation.toViewDU({
    data: data,
    aggregationBits: attestation.aggregationBits,
    inclusionDelay: slot - data.slot,
    proposerIndex: epochCtx.getBeaconProposer(slot),
  });

  if (data.target.epoch === epochCtx.epoch) {
    if (!ssz.phase0.Checkpoint.equals(data.source, state.currentJustifiedCheckpoint)) {
      throw new Error(
        `Attestation source does not equal current justified checkpoint: source=${checkpointToStr(
          data.source
        )} currentJustifiedCheckpoint=${checkpointToStr(state.currentJustifiedCheckpoint)}`
      );
    }
    state.currentEpochAttestations.push(pendingAttestation);
  } else {
    if (!ssz.phase0.Checkpoint.equals(data.source, state.previousJustifiedCheckpoint)) {
      throw new Error(
        `Attestation source does not equal previous justified checkpoint: source=${checkpointToStr(
          data.source
        )} previousJustifiedCheckpoint=${checkpointToStr(state.previousJustifiedCheckpoint)}`
      );
    }
    state.previousEpochAttestations.push(pendingAttestation);
  }

  if (!isValidIndexedAttestation(state, epochCtx.getIndexedAttestation(ForkSeq.phase0, attestation), verifySignature)) {
    throw new Error("Attestation is not valid");
  }
}

export function validateAttestation(fork: ForkSeq, state: CachedBeaconStateAllForks, attestation: Attestation): void {
  const {epochCtx} = state;
  const slot = state.slot;
  const data = attestation.data;
  const computedEpoch = computeEpochAtSlot(data.slot);
  const committeeCount = epochCtx.getCommitteeCountPerSlot(computedEpoch);

  if (!(data.target.epoch === epochCtx.previousShuffling.epoch || data.target.epoch === epochCtx.epoch)) {
    throw new Error(
      "Attestation target epoch not in previous or current epoch: " +
        `targetEpoch=${data.target.epoch} currentEpoch=${epochCtx.epoch}`
    );
  }
  if (!(data.target.epoch === computedEpoch)) {
    throw new Error(
      "Attestation target epoch does not match epoch computed from slot: " +
        `targetEpoch=${data.target.epoch} computedEpoch=${computedEpoch}`
    );
  }

  // post deneb, the attestations are valid till end of next epoch
  if (!(data.slot + MIN_ATTESTATION_INCLUSION_DELAY <= slot && isTimelyTarget(fork, slot - data.slot))) {
    throw new Error(
      "Attestation slot not within inclusion window: " +
        `slot=${data.slot} window=${data.slot + MIN_ATTESTATION_INCLUSION_DELAY}..${data.slot + SLOTS_PER_EPOCH}`
    );
  }

  if (fork >= ForkSeq.electra) {
    assert.equal(data.index, 0, `AttestationData.index must be zero: index=${data.index}`);
    const attestationElectra = attestation as electra.Attestation;
    const committeeIndices = attestationElectra.committeeBits.getTrueBitIndexes();

    if (committeeIndices.length === 0) {
      throw Error("Attestation should have at least one committee bit set");
    }

    const lastCommitteeIndex = committeeIndices[committeeIndices.length - 1];
    if (lastCommitteeIndex >= committeeCount) {
      throw new Error(
        `Attestation committee index exceeds committee count: lastCommitteeIndex=${lastCommitteeIndex} numCommittees=${committeeCount}`
      );
    }

    // Get total number of attestation participant of every committee specified
    const participantCount = committeeIndices
      .map((committeeIndex) => epochCtx.getBeaconCommittee(data.slot, committeeIndex).length)
      .reduce((acc, committeeSize) => acc + committeeSize, 0);

    assert.equal(
      attestationElectra.aggregationBits.bitLen,
      participantCount,
      `Attestation aggregation bits length does not match total number of committee participant aggregationBitsLength=${attestation.aggregationBits.bitLen} participantCount=${participantCount}`
    );
  } else {
    if (!(data.index < committeeCount)) {
      throw new Error(
        "Attestation committee index not within current committee count: " +
          `committeeIndex=${data.index} committeeCount=${committeeCount}`
      );
    }

    const committee = epochCtx.getBeaconCommittee(data.slot, data.index);
    if (attestation.aggregationBits.bitLen !== committee.length) {
      throw new Error(
        "Attestation aggregation bits length does not match committee length: " +
          `aggregationBitsLength=${attestation.aggregationBits.bitLen} committeeLength=${committee.length}`
      );
    }
  }
}

// Modified https://github.com/ethereum/consensus-specs/pull/3360
export function isTimelyTarget(fork: ForkSeq, inclusionDistance: Slot): boolean {
  // post deneb attestation is valid till end of next epoch for target
  if (fork >= ForkSeq.deneb) {
    return true;
  }
  return inclusionDistance <= SLOTS_PER_EPOCH;
}

export function checkpointToStr(checkpoint: phase0.Checkpoint): string {
  return `${toRootHex(checkpoint.root)}:${checkpoint.epoch}`;
}
