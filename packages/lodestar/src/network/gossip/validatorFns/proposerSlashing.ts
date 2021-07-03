import {phase0} from "@chainsafe/lodestar-types";
import {validateGossipProposerSlashing} from "../../../chain/validation";
import {IObjectValidatorModules, GossipTopic} from "../interface";

export async function validateProposerSlashing(
  {chain, db}: IObjectValidatorModules,
  _topic: GossipTopic,
  proposerSlashing: phase0.ProposerSlashing
): Promise<void> {
  await validateGossipProposerSlashing(chain, db, proposerSlashing);
}
