import {phase0} from "@chainsafe/lodestar-types";
import {validateGossipAttesterSlashing} from "../../../chain/validation";
import {IObjectValidatorModules, GossipTopic} from "../interface";

export async function validateAttesterSlashing(
  {chain, db, logger}: IObjectValidatorModules,
  _topic: GossipTopic,
  attesterSlashing: phase0.AttesterSlashing
): Promise<void> {
  await validateGossipAttesterSlashing(chain, db, attesterSlashing);

  // Handler

  db.attesterSlashing.add(attesterSlashing).catch((e) => {
    logger.error("Error adding attesterSlashing to pool", {}, e);
  });
}
