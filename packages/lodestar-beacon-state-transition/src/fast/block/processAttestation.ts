import {Attestation, BeaconState} from "@chainsafe/lodestar-types";

import {computeEpochAtSlot} from "../../util";
import {EpochContext} from "../util";
import {isValidIndexedAttestation} from "./isValidIndexedAttestation";


export function processAttestation(
  epochCtx: EpochContext,
  state: BeaconState,
  attestation: Attestation,
  verifySignature = true,
): void {
  const config = epochCtx.config;
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
  if (!(
    data.target.epoch === epochCtx.previousShuffling.epoch ||
    data.target.epoch === epochCtx.currentShuffling.epoch
  )) {
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

  const pendingAttestation = {
    data: data,
    aggregationBits: attestation.aggregationBits,
    inclusionDelay: slot - data.slot,
    proposerIndex: epochCtx.getBeaconProposer(slot),
  };

  if (data.target.epoch === epochCtx.currentShuffling.epoch) {
    if (!config.types.Checkpoint.equals(data.source, state.currentJustifiedCheckpoint)) {
      throw new Error(
        "Attestation source does not equal current justified checkpoint: " +
        `source=${config.types.Checkpoint.toJson(data.source)} ` +
        `currentJustifiedCheckpoint=${config.types.Checkpoint.toJson(state.currentJustifiedCheckpoint)}`
      );
    }
    state.currentEpochAttestations.push(pendingAttestation);
  } else {
    if (!config.types.Checkpoint.equals(data.source, state.previousJustifiedCheckpoint)) {
      throw new Error(
        "Attestation source does not equal previous justified checkpoint: " +
        `source=${config.types.Checkpoint.toJson(data.source)} ` +
        `previousJustifiedCheckpoint=${config.types.Checkpoint.toJson(state.previousJustifiedCheckpoint)}`
      );
    }
    state.previousEpochAttestations.push(pendingAttestation);
  }

  if (!isValidIndexedAttestation(epochCtx, state, epochCtx.getIndexedAttestation(attestation), verifySignature)) {
    throw new Error("Attestation is not valid");
  }
}
