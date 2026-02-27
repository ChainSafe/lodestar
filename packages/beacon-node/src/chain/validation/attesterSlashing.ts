import {
  assertValidAttesterSlashing,
  getAttesterSlashableIndices,
  getAttesterSlashingSignatureSets,
  isSlashableValidator,
} from "@lodestar/state-transition";
import {AttesterSlashing} from "@lodestar/types";
import {AttesterSlashingError, AttesterSlashingErrorCode, GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../index.js";

export async function validateApiAttesterSlashing(
  chain: IBeaconChain,
  attesterSlashing: AttesterSlashing
): Promise<void> {
  const prioritizeBls = true;
  return validateAttesterSlashing(chain, attesterSlashing, prioritizeBls);
}

export async function validateGossipAttesterSlashing(
  chain: IBeaconChain,
  attesterSlashing: AttesterSlashing
): Promise<void> {
  return validateAttesterSlashing(chain, attesterSlashing);
}

export async function validateAttesterSlashing(
  chain: IBeaconChain,
  attesterSlashing: AttesterSlashing,
  prioritizeBls = false
): Promise<void> {
  // [IGNORE] At least one index in the intersection of the attesting indices of each attestation has not yet been seen
  // in any prior attester_slashing (i.e.
  //   attester_slashed_indices = set(attestation_1.attesting_indices).intersection(attestation_2.attesting_indices
  // ), verify if any(attester_slashed_indices.difference(prior_seen_attester_slashed_indices))).
  const intersectingIndices = getAttesterSlashableIndices(attesterSlashing);
  if (chain.opPool.hasSeenAttesterSlashing(intersectingIndices)) {
    throw new AttesterSlashingError(GossipAction.IGNORE, {
      code: AttesterSlashingErrorCode.ALREADY_EXISTS,
    });
  }

  const state = chain.getHeadState();

  // [REJECT] All of the conditions within process_attester_slashing pass validation.
  try {
    // verifySignature = false, verified in batch below
    assertValidAttesterSlashing(
      chain.config,
      chain.pubkeyCache,
      state.slot,
      state.validators.length,
      attesterSlashing,
      false
    );
  } catch (e) {
    throw new AttesterSlashingError(GossipAction.REJECT, {
      code: AttesterSlashingErrorCode.INVALID,
      error: e as Error,
    });
  }

  // Additional gossip-side check: assertValidAttesterSlashing() validates slashable data/signatures,
  // but it does not enforce that any intersecting validator is currently slashable.
  // Spec reference: process_attester_slashing() requires slashed_any == True after iterating intersecting indices.
  const currentEpoch = state.epochCtx.epoch;
  const validators = state.validators;
  if (!intersectingIndices.some((index) => isSlashableValidator(validators.getReadonly(index), currentEpoch))) {
    throw new AttesterSlashingError(GossipAction.REJECT, {
      code: AttesterSlashingErrorCode.INVALID,
      error: Error("AttesterSlashing has no slashable validators"),
    });
  }

  const signatureSets = getAttesterSlashingSignatureSets(chain.config, state.slot, attesterSlashing);
  if (!(await chain.bls.verifySignatureSets(signatureSets, {batchable: true, priority: prioritizeBls}))) {
    throw new AttesterSlashingError(GossipAction.REJECT, {
      code: AttesterSlashingErrorCode.INVALID,
      error: Error("Invalid signature"),
    });
  }
}
