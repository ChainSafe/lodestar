import {phase0, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconChain} from "..";
import {PeerAction} from "../../network/peers";
import {ProposerSlashingError, ProposerSlashingErrorCode, GossipAction} from "../errors";

export async function validateGossipProposerSlashing(
  chain: IBeaconChain,
  proposerSlashing: phase0.ProposerSlashing
): Promise<void> {
  // [IGNORE] The proposer slashing is the first valid proposer slashing received for the proposer with index
  // proposer_slashing.signed_header_1.message.proposer_index.
  if (chain.opPool.hasSeenProposerSlashing(proposerSlashing.signedHeader1.message.proposerIndex)) {
    throw new ProposerSlashingError(GossipAction.IGNORE, null, {
      code: ProposerSlashingErrorCode.ALREADY_EXISTS,
    });
  }

  const state = chain.getHeadState();

  // [REJECT] All of the conditions within process_proposer_slashing pass validation.
  try {
    // verifySignature = false, verified in batch below
    allForks.assertValidProposerSlashing(state, proposerSlashing, false);
  } catch (e) {
    throw new ProposerSlashingError(GossipAction.REJECT, PeerAction.HighToleranceError, {
      code: ProposerSlashingErrorCode.INVALID,
      error: e as Error,
    });
  }

  const signatureSets = allForks.getProposerSlashingSignatureSets(state, proposerSlashing);
  if (!(await chain.bls.verifySignatureSets(signatureSets, {batchable: true}))) {
    throw new ProposerSlashingError(GossipAction.REJECT, PeerAction.HighToleranceError, {
      code: ProposerSlashingErrorCode.INVALID,
      error: Error("Invalid signature"),
    });
  }
}
