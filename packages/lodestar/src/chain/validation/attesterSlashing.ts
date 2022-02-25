import {phase0, allForks, getAttesterSlashableIndices} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconChain} from "..";
import {PeerAction} from "../../network/peers";
import {AttesterSlashingError, AttesterSlashingErrorCode, GossipAction} from "../errors";

export async function validateGossipAttesterSlashing(
  chain: IBeaconChain,
  attesterSlashing: phase0.AttesterSlashing
): Promise<void> {
  // [IGNORE] At least one index in the intersection of the attesting indices of each attestation has not yet been seen
  // in any prior attester_slashing (i.e.
  //   attester_slashed_indices = set(attestation_1.attesting_indices).intersection(attestation_2.attesting_indices
  // ), verify if any(attester_slashed_indices.difference(prior_seen_attester_slashed_indices))).
  const intersectingIndices = getAttesterSlashableIndices(attesterSlashing);
  if (chain.opPool.hasSeenAttesterSlashing(intersectingIndices)) {
    throw new AttesterSlashingError(GossipAction.IGNORE, null, {
      code: AttesterSlashingErrorCode.ALREADY_EXISTS,
    });
  }

  const state = chain.getHeadState();

  // [REJECT] All of the conditions within process_attester_slashing pass validation.
  try {
    // verifySignature = false, verified in batch below
    allForks.assertValidAttesterSlashing(state, attesterSlashing, false);
  } catch (e) {
    throw new AttesterSlashingError(GossipAction.REJECT, PeerAction.HighToleranceError, {
      code: AttesterSlashingErrorCode.INVALID,
      error: e as Error,
    });
  }

  const signatureSets = allForks.getAttesterSlashingSignatureSets(state, attesterSlashing);
  if (!(await chain.bls.verifySignatureSets(signatureSets, {batchable: true}))) {
    throw new AttesterSlashingError(GossipAction.REJECT, PeerAction.HighToleranceError, {
      code: AttesterSlashingErrorCode.INVALID,
      error: Error("Invalid signature"),
    });
  }
}
