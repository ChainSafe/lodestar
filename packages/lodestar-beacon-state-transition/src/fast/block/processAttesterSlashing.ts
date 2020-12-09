import {AttesterSlashing, ValidatorIndex} from "@chainsafe/lodestar-types";

import {isSlashableValidator, isSlashableAttestationData} from "../../util";
import {EpochContext, CachedValidatorsBeaconState} from "../util";
import {slashValidator} from "./slashValidator";
import {isValidIndexedAttestation} from "./isValidIndexedAttestation";

export function processAttesterSlashing(
  epochCtx: EpochContext,
  state: CachedValidatorsBeaconState,
  attesterSlashing: AttesterSlashing,
  verifySignatures = true
): void {
  const config = epochCtx.config;
  const attestation1 = attesterSlashing.attestation1;
  const attestation2 = attesterSlashing.attestation2;
  if (!isSlashableAttestationData(config, attestation1.data, attestation2.data)) {
    throw new Error("AttesterSlashing is not slashable");
  }
  if (!isValidIndexedAttestation(epochCtx, state, attestation1, verifySignatures)) {
    throw new Error("AttesterSlashing attestation1 is not a valid IndexedAttestation");
  }
  if (!isValidIndexedAttestation(epochCtx, state, attestation2, verifySignatures)) {
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
  indices
    .sort((a, b) => a - b)
    .forEach((index) => {
      if (isSlashableValidator(validators[index], epochCtx.currentShuffling.epoch)) {
        slashValidator(epochCtx, state, index);
        slashedAny = true;
      }
    });
  if (!slashedAny) {
    throw new Error("AttesterSlashing did not result in any slashings");
  }
}
