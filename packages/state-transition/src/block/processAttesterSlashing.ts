import {BeaconConfig} from "@lodestar/config";
import {ForkPreEip8453, ForkSeq} from "@lodestar/params";
import {AttesterSlashing, Slot, ValidatorIndex, eip8453} from "@lodestar/types";
import {CachedBeaconStateAllForks, CachedBeaconStateEip8453} from "../types.js";
import {isSlashableAttestationDataEip8453, isValidIndexedAttestationBigintEip8453} from "../util/eip8453.js";
import {
  getAttesterSlashableIndices,
  getIntersectingIndices,
  isSlashableAttestationData,
  isSlashableValidator,
} from "../util/index.js";
import {isValidIndexedAttestationBigint} from "./isValidIndexedAttestation.js";
import {slashValidator} from "./slashValidator.js";

/**
 * Process an AttesterSlashing operation. Initiates the exit of a validator, decreases the balance of the slashed
 * validators and increases the block proposer balance.
 *
 * PERF: Work depends on number of AttesterSlashing per block. On regular networks the average is 0 / block.
 */
export function processAttesterSlashing(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  attesterSlashing: AttesterSlashing,
  verifySignatures = true
): void {
  if (fork >= ForkSeq.eip8453) {
    processAttesterSlashingEip8453(
      state as CachedBeaconStateEip8453,
      attesterSlashing as eip8453.AttesterSlashing,
      verifySignatures
    );
    return;
  }
  assertValidAttesterSlashing(
    state.config,
    state.slot,
    state.validators.length,
    attesterSlashing as AttesterSlashing<ForkPreEip8453>,
    verifySignatures
  );
  slashIntersectingIndices(
    fork,
    state,
    getAttesterSlashableIndices(attesterSlashing as AttesterSlashing<ForkPreEip8453>)
  );
}

/**
 * Spec: process_attester_slashing with the finality gadget slashing rules, `is_slashable_attestation_data`
 * [Modified in EIP8453] and `is_valid_indexed_attestation` [Modified in EIP8453].
 */
export function processAttesterSlashingEip8453(
  state: CachedBeaconStateEip8453,
  attesterSlashing: eip8453.AttesterSlashing,
  verifySignatures = true
): void {
  const {attestation1, attestation2} = attesterSlashing;
  if (!isSlashableAttestationDataEip8453(attestation1.data, attestation2.data)) {
    throw new Error("AttesterSlashing is not slashable");
  }
  for (const [i, attestation] of [attestation1, attestation2].entries()) {
    if (!isValidIndexedAttestationBigintEip8453(state, attestation, verifySignatures)) {
      throw new Error(`AttesterSlashing attestation${i} is invalid`);
    }
  }
  slashIntersectingIndices(
    ForkSeq.eip8453,
    state,
    getIntersectingIndices(attestation1.attestingIndices, attestation2.attestingIndices)
  );
}

/**
 * Spec: process_legacy_attester_slashing, slashings of Casper FFG attestations made before EIP8453.
 * `is_slashable_legacy_attestation_data` and `is_valid_legacy_indexed_attestation` are the Heze rules.
 */
export function processLegacyAttesterSlashing(
  state: CachedBeaconStateEip8453,
  attesterSlashing: AttesterSlashing<ForkPreEip8453>,
  verifySignatures = true
): void {
  assertValidAttesterSlashing(state.config, state.slot, state.validators.length, attesterSlashing, verifySignatures);
  slashIntersectingIndices(ForkSeq.eip8453, state, getAttesterSlashableIndices(attesterSlashing));
}

function slashIntersectingIndices(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  intersectingIndices: ValidatorIndex[]
): void {
  const {epochCtx} = state;
  let slashedAny = false;
  const validators = state.validators; // Get the validators sub tree once for all indices
  // Spec requires to sort indexes beforehand
  for (const index of intersectingIndices.sort((a, b) => a - b)) {
    if (isSlashableValidator(validators.getReadonly(index), epochCtx.epoch)) {
      slashValidator(fork, state, index);
      slashedAny = true;
    }
  }

  if (!slashedAny) {
    throw new Error("AttesterSlashing did not result in any slashings");
  }
}

export function assertValidAttesterSlashing(
  config: BeaconConfig,
  stateSlot: Slot,
  validatorsLen: number,
  attesterSlashing: AttesterSlashing<ForkPreEip8453>,
  verifySignatures = true
): void {
  const attestation1 = attesterSlashing.attestation1;
  const attestation2 = attesterSlashing.attestation2;

  if (!isSlashableAttestationData(attestation1.data, attestation2.data)) {
    throw new Error("AttesterSlashing is not slashable");
  }

  // In state transition, AttesterSlashing attestations are only partially validated. Their slot and epoch could
  // be higher than the clock and the slashing would still be valid. Same applies to attestation data index, which
  // can be any arbitrary value. Must use bigint variants to hash correctly to all possible values
  for (const [i, attestation] of [attestation1, attestation2].entries()) {
    if (!isValidIndexedAttestationBigint(config, stateSlot, validatorsLen, attestation, verifySignatures)) {
      throw new Error(`AttesterSlashing attestation${i} is invalid`);
    }
  }
}
