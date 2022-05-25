import {phase0, ssz} from "@chainsafe/lodestar-types";

import {computeEpochAtSlot} from "../../util/index.js";
import {CachedBeaconStatePhase0, CachedBeaconStateAllForks} from "../../types.js";
import {isValidIndexedAttestation} from "../../allForks/block/index.js";
import {MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {toHexString} from "@chainsafe/ssz";

/**
 * Process an Attestation operation. Validates an attestation and appends it to state.currentEpochAttestations or
 * state.previousEpochAttestations to be processed in bulk at the epoch transition.
 *
 * PERF: Work depends on number of Attestation per block. On mainnet the average is 89.7 / block, with 87.8 participant
 * true bits on average. See `packages/beacon-state-transition/test/perf/analyzeBlocks.ts`
 */
export function processAttestation(
  state: CachedBeaconStatePhase0,
  attestation: phase0.Attestation,
  verifySignature = true
): void {
  const {epochCtx} = state;
  const slot = state.slot;
  const data = attestation.data;

  validateAttestation(state, attestation);

  const pendingAttestation = ssz.phase0.PendingAttestation.toViewDU({
    data: data,
    aggregationBits: attestation.aggregationBits,
    inclusionDelay: slot - data.slot,
    proposerIndex: epochCtx.getBeaconProposer(slot),
  });

  if (data.target.epoch === epochCtx.currentShuffling.epoch) {
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

  if (!isValidIndexedAttestation(state, epochCtx.getIndexedAttestation(attestation), verifySignature)) {
    throw new Error("Attestation is not valid");
  }
}

export function validateAttestation(state: CachedBeaconStateAllForks, attestation: phase0.Attestation): void {
  const {epochCtx} = state;
  const slot = state.slot;
  const data = attestation.data;
  const computedEpoch = computeEpochAtSlot(data.slot);
  const committeeCount = epochCtx.getCommitteeCountPerSlot(computedEpoch);
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
  if (attestation.aggregationBits.bitLen !== committee.length) {
    throw new Error(
      "Attestation aggregation bits length does not match committee length: " +
        `aggregationBitsLength=${attestation.aggregationBits.bitLen} committeeLength=${committee.length}`
    );
  }
}

export function checkpointToStr(checkpoint: phase0.Checkpoint): string {
  return `${toHexString(checkpoint.root)}:${checkpoint.epoch}`;
}
