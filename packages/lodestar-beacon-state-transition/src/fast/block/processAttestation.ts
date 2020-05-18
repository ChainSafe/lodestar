import {Attestation, BeaconState, IndexedAttestation} from "@chainsafe/lodestar-types";

import {computeEpochAtSlot} from "../../util";
import {EpochContext} from "../util";
import {isValidIndexedAttestation} from "./isValidIndexedAttestation";


export function processAttestation(
  epochCtx: EpochContext,
  state: BeaconState,
  attestation: Attestation,
): void {
  const config = epochCtx.config;
  const {MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH} = config.params;
  const slot = state.slot;
  const data = attestation.data;
  if (!(data.index < epochCtx.getCommitteeCountAtSlot(data.slot))) {
    throw new Error();
  }
  if (!(
    data.target.epoch === epochCtx.previousShuffling.epoch ||
    data.target.epoch === epochCtx.currentShuffling.epoch
  )) {
    throw new Error();
  }
  if (!(data.target.epoch === computeEpochAtSlot(config, data.slot))) {
    throw new Error();
  }
  if (!(data.slot + MIN_ATTESTATION_INCLUSION_DELAY <= slot && slot <= data.slot + SLOTS_PER_EPOCH)) {
    throw new Error();
  }

  const committee = epochCtx.getBeaconCommittee(data.slot, data.index);
  if (attestation.aggregationBits.length !== committee.length) {
    throw new Error();
  }

  const pendingAttestation = {
    data: data,
    aggregationBits: attestation.aggregationBits,
    inclusionDelay: slot - data.slot,
    proposerIndex: epochCtx.getBeaconProposer(slot),
  };

  if (data.target.epoch === epochCtx.currentShuffling.epoch) {
    if (!config.types.Checkpoint.equals(data.source, state.currentJustifiedCheckpoint)) {
      throw new Error();
    }
    state.currentEpochAttestations.push(pendingAttestation);
  } else {
    if (!config.types.Checkpoint.equals(data.source, state.previousJustifiedCheckpoint)) {
      throw new Error();
    }
    state.previousEpochAttestations.push(pendingAttestation);
  }

  // return the indexed attestation corresponding to attestation
  const getIndexedAttestation = (attestation: Attestation): IndexedAttestation => {
    const bits = Array.from(attestation.aggregationBits);
    const committee = epochCtx.getBeaconCommittee(data.slot, data.index);
    const attestingIndices = new Set<number>();
    committee.forEach((index, i) => {
      if (bits[i]) {
        attestingIndices.add(index);
      }
    });

    return {
      attestingIndices: [...attestingIndices.values()].sort(),
      data: data,
      signature: attestation.signature,
    };
  };

  if (!isValidIndexedAttestation(epochCtx, state, getIndexedAttestation(attestation))) {
    throw new Error();
  }
}
