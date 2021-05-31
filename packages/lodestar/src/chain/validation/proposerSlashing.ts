import {isValidProposerSlashing, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "..";
import {ProposerSlashingError, ProposerSlashingErrorCode} from "../errors/proposerSlashingError";
import {IBeaconDb} from "../../db";
import {GossipAction} from "../errors";

export async function validateGossipProposerSlashing(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  proposerSlashing: phase0.ProposerSlashing
): Promise<void> {
  // [IGNORE] The proposer slashing is the first valid proposer slashing received for the proposer
  // with index proposer_slashing.signed_header_1.message.proposer_index.
  if (await db.proposerSlashing.has(proposerSlashing.signedHeader1.message.proposerIndex)) {
    throw new ProposerSlashingError(GossipAction.IGNORE, {
      code: ProposerSlashingErrorCode.SLASHING_ALREADY_EXISTS,
    });
  }

  const state = chain.getHeadState();

  // [REJECT] All of the conditions within process_proposer_slashing pass validation.
  // verifySignature = false, verified in batch below
  if (!isValidProposerSlashing(config, state, proposerSlashing, false)) {
    throw new ProposerSlashingError(GossipAction.REJECT, {
      code: ProposerSlashingErrorCode.INVALID_SLASHING,
    });
  }

  const signatureSets = allForks.getProposerSlashingSignatureSets(state, proposerSlashing);
  if (!(await chain.bls.verifySignatureSets(signatureSets))) {
    throw new ProposerSlashingError(GossipAction.REJECT, {
      code: ProposerSlashingErrorCode.INVALID_SLASHING,
    });
  }
}
