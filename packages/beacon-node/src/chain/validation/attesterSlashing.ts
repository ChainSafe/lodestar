import {phase0} from "@lodestar/types";
import {
  getAttesterSlashableIndices,
  assertValidAttesterSlashing,
  getAttesterSlashingSignatureSets,
} from "@lodestar/state-transition";
import {IBeaconChain} from "../index.js";
import {AttesterSlashingError, AttesterSlashingErrorCode, GossipAction} from "../errors/index.js";

export async function validateApiAttesterSlashing(
  chain: IBeaconChain,
  attesterSlashing: phase0.AttesterSlashing // TODO Electra: Handle electra.AttesterSlashing
): Promise<void> {
  const prioritizeBls = true;
  return validateAttesterSlashing(chain, attesterSlashing, prioritizeBls);
}

export async function validateGossipAttesterSlashing(
  chain: IBeaconChain,
  attesterSlashing: phase0.AttesterSlashing
): Promise<void> {
  return validateAttesterSlashing(chain, attesterSlashing);
}

export async function validateAttesterSlashing(
  chain: IBeaconChain,
  attesterSlashing: phase0.AttesterSlashing,
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
    assertValidAttesterSlashing(state, attesterSlashing, false);
  } catch (e) {
    throw new AttesterSlashingError(GossipAction.REJECT, {
      code: AttesterSlashingErrorCode.INVALID,
      error: e as Error,
    });
  }

  const signatureSets = getAttesterSlashingSignatureSets(state, attesterSlashing);
  if (!(await chain.bls.verifySignatureSets(signatureSets, {batchable: true, priority: prioritizeBls}))) {
    throw new AttesterSlashingError(GossipAction.REJECT, {
      code: AttesterSlashingErrorCode.INVALID,
      error: Error("Invalid signature"),
    });
  }
}
