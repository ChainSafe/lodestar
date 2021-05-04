import {allForks, altair, phase0, ValidatorIndex} from "@chainsafe/lodestar-types";

import {isSlashableValidator, isSlashableAttestationData} from "../../../util";
import {CachedBeaconState} from "../../../fast/util";
import {isValidIndexedAttestation} from "../../../fast/block";
import {slashValidator} from "./slashValidator";

export function processAttesterSlashing(
  state: CachedBeaconState<altair.BeaconState>,
  attesterSlashing: phase0.AttesterSlashing,
  verifySignatures = true
): void {
  const {config, epochCtx} = state;
  const attestation1 = attesterSlashing.attestation1;
  const attestation2 = attesterSlashing.attestation2;
  if (!isSlashableAttestationData(config, attestation1.data, attestation2.data)) {
    throw new Error("AttesterSlashing is not slashable");
  }
  if (!isValidIndexedAttestation(state as CachedBeaconState<allForks.BeaconState>, attestation1, verifySignatures)) {
    throw new Error("AttesterSlashing attestation1 is not a valid IndexedAttestation");
  }
  if (!isValidIndexedAttestation(state as CachedBeaconState<allForks.BeaconState>, attestation2, verifySignatures)) {
    throw new Error("AttesterSlashing attestation2 is not a valid IndexedAttestation");
  }

  let slashedAny = false;
  const attSet1 = new Set(attestation1.attestingIndices);
  const attSet2 = new Set(attestation2.attestingIndices);
  const indices: ValidatorIndex[] = [];
  for (const i of attSet1.values()) {
    if (attSet2.has(i)) {
      indices.push(i);
    }
  }
  const validators = state.validators;
  for (const index of indices.sort((a, b) => a - b)) {
    if (isSlashableValidator(validators[index], epochCtx.currentShuffling.epoch)) {
      slashValidator(state, index);
      slashedAny = true;
    }
  }
  if (!slashedAny) {
    throw new Error("AttesterSlashing did not result in any slashings");
  }
}
