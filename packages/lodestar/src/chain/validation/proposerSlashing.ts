import {phase0, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
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
      code: ProposerSlashingErrorCode.ALREADY_EXISTS,
    });
  }

  const state = chain.getHeadState();

  try {
    // verifySignature = false, verified in batch below
    phase0.assertValidProposerSlashing(state, proposerSlashing, false);
  } catch (e) {
    throw new ProposerSlashingError({
      code: ProposerSlashingErrorCode.INVALID,
      error: e as Error,
    });
  }

  const signatureSets = allForks.getProposerSlashingSignatureSets(state, proposerSlashing);
  if (!(await chain.bls.verifySignatureSets(signatureSets))) {
    throw new ProposerSlashingError({
      code: ProposerSlashingErrorCode.INVALID,
      error: Error("Invalid signature"),
    });
  }
}
