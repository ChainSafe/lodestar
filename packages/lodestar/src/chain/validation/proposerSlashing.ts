import {isValidProposerSlashing, fast} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "..";
import {ProposerSlashingError, ProposerSlashingErrorCode} from "../errors/proposerSlashingError";
import {IBeaconDb} from "../../db";

export async function validateGossipProposerSlashing(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  proposerSlashing: phase0.ProposerSlashing
): Promise<void> {
  if (await db.proposerSlashing.has(proposerSlashing.signedHeader1.message.proposerIndex)) {
    throw new ProposerSlashingError({
      code: ProposerSlashingErrorCode.SLASHING_ALREADY_EXISTS,
    });
  }

  const state = chain.getHeadState();

  // verifySignature = false, verified in batch below
  if (!isValidProposerSlashing(config, state, proposerSlashing, false)) {
    throw new ProposerSlashingError({
      code: ProposerSlashingErrorCode.INVALID_SLASHING,
    });
  }

  const signatureSets = fast.getProposerSlashingSignatureSets(state, proposerSlashing);
  if (!(await chain.bls.verifySignatureSetsBatch(signatureSets))) {
    throw new ProposerSlashingError({
      code: ProposerSlashingErrorCode.INVALID_SLASHING,
    });
  }
}
