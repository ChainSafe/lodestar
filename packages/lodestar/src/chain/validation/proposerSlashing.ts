import {isValidProposerSlashing} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "..";
import {ProposerSlashingError, ProposerSlashingErrorCode} from "../errors/proposerSlahingError";
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
  if (!isValidProposerSlashing(config, state, proposerSlashing)) {
    throw new ProposerSlashingError({
      code: ProposerSlashingErrorCode.INVALID_SLASHING,
    });
  }
}
