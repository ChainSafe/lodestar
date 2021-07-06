import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {Json} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {validateGossipVoluntaryExit} from "../../../chain/validation";
import {VoluntaryExitError, VoluntaryExitErrorCode} from "../../../chain/errors";
import {IObjectValidatorModules, GossipTopic} from "../interface";
import {GossipValidationError} from "../errors";

export async function validateVoluntaryExit(
  {chain, db, logger}: IObjectValidatorModules,
  _topic: GossipTopic,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<void> {
  try {
    await validateGossipVoluntaryExit(chain, db, voluntaryExit);
    logger.debug("gossip - VoluntaryExit - accept");
  } catch (e) {
    if (!(e instanceof VoluntaryExitError)) {
      logger.error("Gossip voluntary exit validation threw a non-VoluntaryExitError", e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }

    switch (e.type.code) {
      case VoluntaryExitErrorCode.INVALID:
        logger.debug("gossip - VoluntaryExit - reject", (e.type as unknown) as Json);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);

      case VoluntaryExitErrorCode.ALREADY_EXISTS:
      default:
        logger.debug("gossip - VoluntaryExit - ignore", e.type);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  }
}
