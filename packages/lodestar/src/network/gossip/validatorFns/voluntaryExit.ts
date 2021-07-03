import {phase0} from "@chainsafe/lodestar-types";
import {validateGossipVoluntaryExit} from "../../../chain/validation";
import {IObjectValidatorModules, GossipTopic} from "../interface";

export async function validateVoluntaryExit(
  {chain, db, logger}: IObjectValidatorModules,
  _topic: GossipTopic,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<void> {
  await validateGossipVoluntaryExit(chain, db, voluntaryExit);

  // Handler

  db.voluntaryExit.add(voluntaryExit).catch((e) => {
    logger.error("Error adding attesterSlashing to pool", {}, e);
  });
}
