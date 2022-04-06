import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";

import {isSlashableValidator, isSlashableAttestationData, getAttesterSlashableIndices} from "../../util/index.js";
import {CachedBeaconStateAllForks} from "../../types.js";
import {isValidIndexedAttestation} from "./isValidIndexedAttestation.js";
import {slashValidatorAllForks} from "./slashValidator.js";

/**
 * Process an AttesterSlashing operation. Initiates the exit of a validator, decreases the balance of the slashed
 * validators and increases the block proposer balance.
 *
 * PERF: Work depends on number of AttesterSlashing per block. On regular networks the average is 0 / block.
 */
export function processAttesterSlashing(
  fork: ForkName,
  state: CachedBeaconStateAllForks,
  attesterSlashing: phase0.AttesterSlashing,
  verifySignatures = true
): void {
  assertValidAttesterSlashing(state, attesterSlashing, verifySignatures);

  const intersectingIndices = getAttesterSlashableIndices(attesterSlashing);

  let slashedAny = false;
  const validators = state.validators; // Get the validators sub tree once for all indices
  // Spec requires to sort indexes beforehand
  for (const index of intersectingIndices.sort((a, b) => a - b)) {
    if (isSlashableValidator(validators.get(index), state.epochCtx.currentShuffling.epoch)) {
      slashValidatorAllForks(fork, state, index);
      slashedAny = true;
    }
  }

  if (!slashedAny) {
    throw new Error("AttesterSlashing did not result in any slashings");
  }
}

export function assertValidAttesterSlashing(
  state: CachedBeaconStateAllForks,
  attesterSlashing: phase0.AttesterSlashing,
  verifySignatures = true
): void {
  const attestation1 = attesterSlashing.attestation1;
  const attestation2 = attesterSlashing.attestation2;

  if (!isSlashableAttestationData(attestation1.data, attestation2.data)) {
    throw new Error("AttesterSlashing is not slashable");
  }
  if (!isValidIndexedAttestation(state, attestation1, verifySignatures)) {
    throw new Error("AttesterSlashing attestation1 is not a valid IndexedAttestation");
  }
  if (!isValidIndexedAttestation(state, attestation2, verifySignatures)) {
    throw new Error("AttesterSlashing attestation2 is not a valid IndexedAttestation");
  }
}
