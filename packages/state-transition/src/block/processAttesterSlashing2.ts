import {ForkSeq} from "@lodestar/params";
import {decoupled} from "@lodestar/types";
import {CachedBeaconStateDecoupled} from "../types.js";
import {isSlashableAttestationData2, isValidIndexedAttestation2} from "../util/decoupled.js";
import {getIntersectingIndices, isSlashableValidator} from "../util/index.js";
import {slashValidator} from "./slashValidator.js";

// Spec: process_attester_slashing_2 (decoupled-consensus/beacon-chain.md)
export function processAttesterSlashing2(
  state: CachedBeaconStateDecoupled,
  attesterSlashing: decoupled.AttesterSlashing2,
  verifySignatures = true
): void {
  const {attestation1, attestation2} = attesterSlashing;
  if (!isSlashableAttestationData2(attestation1.data, attestation2.data)) {
    throw Error("AttesterSlashing2 is not slashable");
  }
  if (!isValidIndexedAttestation2(state, attestation1, verifySignatures)) {
    throw Error("AttesterSlashing2 attestation1 is invalid");
  }
  if (!isValidIndexedAttestation2(state, attestation2, verifySignatures)) {
    throw Error("AttesterSlashing2 attestation2 is invalid");
  }

  const intersectingIndices = getIntersectingIndices(attestation1.attestingIndices, attestation2.attestingIndices);
  const validators = state.validators;
  let slashedAny = false;
  for (const index of intersectingIndices.sort((a, b) => a - b)) {
    if (isSlashableValidator(validators.getReadonly(index), state.epochCtx.epoch)) {
      slashValidator(ForkSeq.decoupled, state, index);
      slashedAny = true;
    }
  }

  if (!slashedAny) {
    throw Error("AttesterSlashing2 did not result in any slashings");
  }
}
