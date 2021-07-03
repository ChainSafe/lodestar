import {phase0} from "@chainsafe/lodestar-types";
import {validateGossipProposerSlashing} from "../../../chain/validation";
import {IObjectValidatorModules, GossipTopic} from "../interface";

export async function validateProposerSlashing(
  {chain, db, logger}: IObjectValidatorModules,
  _topic: GossipTopic,
  proposerSlashing: phase0.ProposerSlashing
): Promise<void> {
  await validateGossipProposerSlashing(chain, db, proposerSlashing);

  // Handler

  db.proposerSlashing.add(proposerSlashing).catch((e) => {
    logger.error("Error adding attesterSlashing to pool", {}, e);
  });
}
