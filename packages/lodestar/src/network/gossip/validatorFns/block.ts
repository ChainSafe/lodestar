import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {allForks} from "@chainsafe/lodestar-types";
import {Json, toHexString} from "@chainsafe/ssz";
import {validateGossipBlock} from "../../../chain/validation";
import {BlockGossipError, BlockErrorCode, GossipAction} from "../../../chain/errors";
import {IObjectValidatorModules, GossipTopic} from "../interface";
import {GossipValidationError} from "../errors";

export async function validateBeaconBlock(
  {chain, db, config, logger}: IObjectValidatorModules,
  _topic: GossipTopic,
  signedBlock: allForks.SignedBeaconBlock
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
      root: toHexString(config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)),
      slot: signedBlock.message.slot,
    });
  } catch (e) {
    if (!(e instanceof BlockGossipError)) {
      logger.error("gossip - Block - non-BlockError", e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }

    if (e.type.code === BlockErrorCode.FUTURE_SLOT || e.type.code === BlockErrorCode.PARENT_UNKNOWN) {
      // block might be valid in the future
      chain.receiveBlock(signedBlock);
    }

    if (e.action === GossipAction.REJECT) {
      logger.debug("gossip - attestation - reject", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
    } else {
      logger.debug("gossip - attestation - ignore", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  }
}
