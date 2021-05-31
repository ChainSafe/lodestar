import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {phase0} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {validateGossipProposerSlashing} from "../../../chain/validation";
import {ProposerSlashingError} from "../../../chain/errors";
import {IObjectValidatorModules, GossipTopic} from "../interface";
import {GossipValidationError} from "../errors";
import {GossipAction} from "../../../chain/errors";

export async function validateProposerSlashing(
  {chain, db, config, logger}: IObjectValidatorModules,
  _topic: GossipTopic,
  proposerSlashing: phase0.ProposerSlashing
): Promise<void> {
  try {
    await validateGossipProposerSlashing(config, chain, db, proposerSlashing);
    logger.debug("gossip - ProposerSlashing - accept");
  } catch (e) {
    if (!(e instanceof ProposerSlashingError)) {
      logger.error("gossip - ProposerSlashing - non-ProposerSlashingError", e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }

    if (e.action === GossipAction.REJECT) {
      logger.debug("gossip - ProposerSlashing - reject", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
    } else {
      logger.debug("gossip - ProposerSlashing - ignore", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  }
}
