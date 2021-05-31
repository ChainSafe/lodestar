import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {phase0} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {validateGossipAttesterSlashing} from "../../../chain/validation";
import {AttesterSlashingError, GossipAction} from "../../../chain/errors";
import {IObjectValidatorModules, GossipTopic} from "../interface";
import {GossipValidationError} from "../errors";

export async function validateAttesterSlashing(
  {chain, db, config, logger}: IObjectValidatorModules,
  _topic: GossipTopic,
  attesterSlashing: phase0.AttesterSlashing
): Promise<void> {
  try {
    await validateGossipAttesterSlashing(config, chain, db, attesterSlashing);
    logger.debug("gossip - AttesterSlashing - accept");
  } catch (e) {
    if (!(e instanceof AttesterSlashingError)) {
      logger.error("gossip - AttesterSlashing - non-AttesterSlashingError", e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }

    if (e.action === GossipAction.REJECT) {
      logger.debug("gossip - AttesterSlashing - reject", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
    } else {
      logger.debug("gossip - AttesterSlashing - ignore", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  }
}
