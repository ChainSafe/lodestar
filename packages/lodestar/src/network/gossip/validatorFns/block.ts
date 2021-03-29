import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {phase0} from "@chainsafe/lodestar-types";
import {Json, toHexString} from "@chainsafe/ssz";
import {validateGossipBlock} from "../../../chain/validation";
import {BlockError, BlockErrorCode} from "../../../chain/errors";
import {IObjectValidatorModules, GossipTopic} from "../interface";
import {GossipValidationError} from "../errors";

export async function validateBeaconBlock(
  {chain, db, config, logger}: IObjectValidatorModules,
  _topic: GossipTopic,
  signedBlock: phase0.SignedBeaconBlock
): Promise<void> {
  try {
    await validateGossipBlock(config, chain, db, {
      signedBlock,
      reprocess: false,
      prefinalized: false,
      validSignatures: false,
      validProposerSignature: false,
    });
    logger.debug("gossip - Block - accept", {
      root: toHexString(config.types.phase0.BeaconBlock.hashTreeRoot(signedBlock.message)),
      slot: signedBlock.message.slot,
    });
  } catch (e) {
    if (!(e instanceof BlockError)) {
      logger.error("Gossip block validation threw a non-BlockError", e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }

    switch (e.type.code) {
      case BlockErrorCode.PROPOSAL_SIGNATURE_INVALID:
      case BlockErrorCode.INCORRECT_PROPOSER:
      case BlockErrorCode.KNOWN_BAD_BLOCK:
        logger.debug("gossip - Block - reject", e.type);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);

      case BlockErrorCode.FUTURE_SLOT:
      case BlockErrorCode.PARENT_UNKNOWN: // IGNORE
        chain.receiveBlock(signedBlock);
      /** eslit-disable-next-line no-fallthrough */
      case BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT:
      case BlockErrorCode.REPEAT_PROPOSAL:
      default:
        logger.debug("gossip - Block - ignore", e.type as Json);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  }
}
