import {phase0} from "@lodestar/types";
import {assertValidProposerSlashing, getProposerSlashingSignatureSets} from "@lodestar/state-transition";
import {IBeaconChain} from "..";
import {ProposerSlashingError, ProposerSlashingErrorCode, GossipAction} from "../errors/index.js";

export async function validateGossipProposerSlashing(
  chain: IBeaconChain,
  proposerSlashing: phase0.ProposerSlashing
): Promise<void> {
  // [IGNORE] The proposer slashing is the first valid proposer slashing received for the proposer with index
  // proposer_slashing.signed_header_1.message.proposer_index.
  if (chain.opPool.hasSeenProposerSlashing(proposerSlashing.signedHeader1.message.proposerIndex)) {
    throw new ProposerSlashingError(GossipAction.IGNORE, {
      code: ProposerSlashingErrorCode.ALREADY_EXISTS,
    });
  }

  const state = chain.getHeadState();

  // [REJECT] All of the conditions within process_proposer_slashing pass validation.
  try {
    // verifySignature = false, verified in batch below
    assertValidProposerSlashing(state, proposerSlashing, false);
  } catch (e) {
    throw new ProposerSlashingError(GossipAction.REJECT, {
      code: ProposerSlashingErrorCode.INVALID,
      error: e as Error,
    });
  }

  const signatureSets = getProposerSlashingSignatureSets(state, proposerSlashing);
  if (!(await chain.bls.verifySignatureSets(signatureSets, {batchable: true}))) {
    throw new ProposerSlashingError(GossipAction.REJECT, {
      code: ProposerSlashingErrorCode.INVALID,
      error: Error("Invalid signature"),
    });
  }
}
