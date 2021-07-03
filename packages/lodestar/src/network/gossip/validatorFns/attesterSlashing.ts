import {phase0} from "@chainsafe/lodestar-types";
import {validateGossipAttesterSlashing} from "../../../chain/validation";
import {IObjectValidatorModules, GossipTopic} from "../interface";

export async function validateAttesterSlashing(
  {chain, db}: IObjectValidatorModules,
  _topic: GossipTopic,
  attesterSlashing: phase0.AttesterSlashing
): Promise<void> {
  await validateGossipAttesterSlashing(chain, db, attesterSlashing);
}
