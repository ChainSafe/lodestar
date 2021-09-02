import {allForks, phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";

import {isSlashableValidator, isSlashableAttestationData} from "../../util";
import {CachedBeaconState} from "../util";
import {isValidIndexedAttestation} from "./isValidIndexedAttestation";
import {slashValidatorAllForks} from "./slashValidator";
import {BlockProcess} from "../../util/blockProcess";

/**
 * Process an AttesterSlashing operation. Initiates the exit of a validator, decreases the balance of the slashed
 * validators and increases the block proposer balance.
 *
 * PERF: Work depends on number of AttesterSlashing per block. On regular networks the average is 0 / block.
 */
export function processAttesterSlashing(
  fork: ForkName,
  state: CachedBeaconState<allForks.BeaconState>,
  attesterSlashing: phase0.AttesterSlashing,
  blockProcess: BlockProcess,
  verifySignatures = true
): void {
  assertValidAttesterSlashing(state as CachedBeaconState<allForks.BeaconState>, attesterSlashing, verifySignatures);

  // TODO: Is there a more performant intersection algorythm? This should be a utility function: intersect()
  const attSet1 = new Set(attesterSlashing.attestation1.attestingIndices);
  const attSet2 = new Set(attesterSlashing.attestation2.attestingIndices);
  const indices: ValidatorIndex[] = [];
  for (const i of attSet1.values()) {
    if (attSet2.has(i)) {
      indices.push(i);
    }
  }

  let slashedAny = false;
  const validators = state.validators; // Get the validators sub tree once for all indices
  // TODO: Why do we need to sort()? If it necessary add a comment with why
  for (const index of indices.sort((a, b) => a - b)) {
    if (isSlashableValidator(validators[index], state.epochCtx.currentShuffling.epoch)) {
      slashValidatorAllForks(fork, state, index, blockProcess);
      slashedAny = true;
    }
  }

  if (!slashedAny) {
    throw new Error("AttesterSlashing did not result in any slashings");
  }
}

export function assertValidAttesterSlashing(
  state: CachedBeaconState<allForks.BeaconState>,
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
