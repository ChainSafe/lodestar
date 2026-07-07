import {
  assertValidAttesterSlashing,
  getAttesterSlashableIndices,
  getAttesterSlashingSignatureSets,
  isSlashableValidator,
} from "@lodestar/state-transition";
import {AttesterSlashing} from "@lodestar/types";
import type {BeaconEngine} from "../beaconEngine/beaconEngine.js";
import {AttesterSlashingError, AttesterSlashingErrorCode, GossipAction} from "../errors/index.js";

export async function validateApiAttesterSlashing(
  this: BeaconEngine,
  attesterSlashing: AttesterSlashing
): Promise<void> {
  const prioritizeBls = true;
  return validateAttesterSlashing.call(this, attesterSlashing, prioritizeBls);
}

export async function validateGossipAttesterSlashing(
  this: BeaconEngine,
  attesterSlashing: AttesterSlashing
): Promise<void> {
  return validateAttesterSlashing.call(this, attesterSlashing);
}

export async function validateAttesterSlashing(
  this: BeaconEngine,
  attesterSlashing: AttesterSlashing,
  prioritizeBls = false
): Promise<void> {
  // [IGNORE] At least one index in the intersection of the attesting indices of each attestation has not yet been seen
  // in any prior attester_slashing (i.e.
  //   attester_slashed_indices = set(attestation_1.attesting_indices).intersection(attestation_2.attesting_indices
  // ), verify if any(attester_slashed_indices.difference(prior_seen_attester_slashed_indices))).
  const intersectingIndices = getAttesterSlashableIndices(attesterSlashing);
  if (this.opPool.hasSeenAttesterSlashing(intersectingIndices)) {
    throw new AttesterSlashingError(GossipAction.IGNORE, {
      code: AttesterSlashingErrorCode.ALREADY_EXISTS,
    });
  }

  const state = this.getHeadState();

  // [REJECT] All of the conditions within process_attester_slashing pass validation.
  try {
    // verifySignature = false, verified in batch below
    assertValidAttesterSlashing(
      this.config,
      this.pubkeyCache,
      state.slot,
      state.validatorCount,
      attesterSlashing,
      false
    );
  } catch (e) {
    throw new AttesterSlashingError(GossipAction.REJECT, {
      code: AttesterSlashingErrorCode.INVALID,
      error: e as Error,
    });
  }

  const currentEpoch = state.epoch;
  if (!intersectingIndices.some((index) => isSlashableValidator(state.getValidator(index), currentEpoch))) {
    throw new AttesterSlashingError(GossipAction.REJECT, {
      code: AttesterSlashingErrorCode.INVALID,
      error: Error("AttesterSlashing has no slashable validators"),
    });
  }

  const signatureSets = getAttesterSlashingSignatureSets(this.config, state.slot, attesterSlashing);
  if (!(await this.bls.verifySignatureSets(signatureSets, {batchable: true, priority: prioritizeBls}))) {
    throw new AttesterSlashingError(GossipAction.REJECT, {
      code: AttesterSlashingErrorCode.INVALID,
      error: Error("Invalid signature"),
    });
  }
}
