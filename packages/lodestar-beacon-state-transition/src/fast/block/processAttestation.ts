import {Attestation} from "@chainsafe/lodestar-types";

import {computeEpochAtSlot} from "../../util";
import {CachedBeaconState} from "../util/cachedBeaconState";
import {isValidIndexedAttestation} from "./isValidIndexedAttestation";

export function processAttestation(
  cachedState: CachedBeaconState,
  attestation: Attestation,
  verifySignature = true
): void {
  const config = cachedState.config;
  const {MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH} = config.params;
  const slot = cachedState.slot;
  const data = attestation.data;
  const committeeCount = cachedState.getCommitteeCountAtSlot(data.slot);
  if (!(data.index < committeeCount)) {
    throw new Error(
      "Attestation committee index not within current committee count: " +
        `committeeIndex=${data.index} committeeCount=${committeeCount}`
    );
  }
  if (
    !(
      data.target.epoch === cachedState.previousShuffling.epoch ||
      data.target.epoch === cachedState.currentShuffling.epoch
    )
  ) {
    throw new Error(
      "Attestation target epoch not in previous or current epoch: " +
        `targetEpoch=${data.target.epoch} currentEpoch=${cachedState.currentShuffling.epoch}`
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

  const committee = cachedState.getBeaconCommittee(data.slot, data.index);
  if (attestation.aggregationBits.length !== committee.length) {
    throw new Error(
      "Attestation aggregation bits length does not match committee length: " +
        `aggregationBitsLength=${attestation.aggregationBits.length} committeeLength=${committee.length}`
    );
  }

  const pendingAttestation = {
    data: data,
    aggregationBits: attestation.aggregationBits,
    inclusionDelay: slot - data.slot,
    proposerIndex: cachedState.getBeaconProposer(slot),
  };

  if (data.target.epoch === cachedState.currentShuffling.epoch) {
    if (!config.types.Checkpoint.equals(data.source, cachedState.currentJustifiedCheckpoint)) {
      throw new Error(
        "Attestation source does not equal current justified checkpoint: " +
          `source=${config.types.Checkpoint.toJson(data.source)} ` +
          `currentJustifiedCheckpoint=${config.types.Checkpoint.toJson(cachedState.currentJustifiedCheckpoint)}`
      );
    }
    cachedState.currentEpochAttestations.push(pendingAttestation);
  } else {
    if (!config.types.Checkpoint.equals(data.source, cachedState.previousJustifiedCheckpoint)) {
      throw new Error(
        "Attestation source does not equal previous justified checkpoint: " +
          `source=${config.types.Checkpoint.toJson(data.source)} ` +
          `previousJustifiedCheckpoint=${config.types.Checkpoint.toJson(cachedState.previousJustifiedCheckpoint)}`
      );
    }
    cachedState.previousEpochAttestations.push(pendingAttestation);
  }

  if (!isValidIndexedAttestation(cachedState, cachedState.getIndexedAttestation(attestation), verifySignature)) {
    throw new Error("Attestation is not valid");
  }
}
