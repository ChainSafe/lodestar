import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {phase0} from "@chainsafe/lodestar-types";
import {validateGossipAttesterSlashing} from "../../../chain/validation";
import {AttesterSlashingError, AttesterSlashingErrorCode} from "../../../chain/errors";
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
      logger.error("Gossip attester slashing validation threw a non-AttesterSlashingError", e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }

    switch (e.type.code) {
      case AttesterSlashingErrorCode.INVALID_SLASHING:
        logger.debug("gossip - AttesterSlashing - reject", e.type);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);

      case AttesterSlashingErrorCode.SLASHING_ALREADY_EXISTS:
      default:
        logger.debug("gossip - AttesterSlashing - ignore", e.type);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  }
}
