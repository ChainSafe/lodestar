import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {phase0} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {validateGossipVoluntaryExit} from "../../../chain/validation";
import {GossipAction, VoluntaryExitError} from "../../../chain/errors";
import {IObjectValidatorModules, GossipTopic} from "../interface";
import {GossipValidationError} from "../errors";

export async function validateVoluntaryExit(
  {chain, db, config, logger}: IObjectValidatorModules,
  _topic: GossipTopic,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<void> {
  try {
    await validateGossipVoluntaryExit(config, chain, db, voluntaryExit);
    logger.debug("gossip - VoluntaryExit - accept");
  } catch (e) {
    if (!(e instanceof VoluntaryExitError)) {
      logger.error("gossip - VoluntaryExit - non-VoluntaryExitError", e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }

    if (e.action === GossipAction.REJECT) {
      logger.debug("gossip - VoluntaryExit - reject", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
    } else {
      logger.debug("gossip - VoluntaryExit - ignore", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  }
}
