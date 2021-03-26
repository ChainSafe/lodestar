import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {phase0} from "@chainsafe/lodestar-types";
import {validateGossipProposerSlashing} from "../../../chain/validation";
import {ProposerSlashingError, ProposerSlashingErrorCode} from "../../../chain/errors";
import {IObjectValidatorModules, GossipTopic} from "../interface";
import {GossipValidationError} from "../errors";

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
      logger.error("Gossip proposer slashing validation threw a non-ProposerSlashingError", e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }

    switch (e.type.code) {
      case ProposerSlashingErrorCode.INVALID_SLASHING:
        logger.debug("gossip - ProposerSlashing - reject", e.type);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);

      case ProposerSlashingErrorCode.SLASHING_ALREADY_EXISTS:
      default:
        logger.debug("gossip - ProposerSlashing - ignore", e.type);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  }
}
