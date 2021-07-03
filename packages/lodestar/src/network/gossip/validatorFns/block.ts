import {allForks} from "@chainsafe/lodestar-types";
import {validateGossipBlock} from "../../../chain/validation";
import {BlockError, BlockErrorCode} from "../../../chain/errors";
import {IObjectValidatorModules, GossipTopic} from "../interface";
import {OpSource} from "../../../metrics/validatorMonitor";

export async function validateBeaconBlock(
  {chain, db, config, metrics, logger}: IObjectValidatorModules,
  _topic: GossipTopic,
  signedBlock: allForks.SignedBeaconBlock
): Promise<void> {
  const seenTimestampSec = Date.now() / 1000;

  try {
    await validateGossipBlock(config, chain, db, {
      signedBlock,
      reprocess: false,
      prefinalized: false,
      validSignatures: false,
      validProposerSignature: false,
    });

    metrics?.registerBeaconBlock(OpSource.api, seenTimestampSec, signedBlock.message);

    // Handler

    try {
      chain.receiveBlock(signedBlock);
    } catch (e) {
      logger.error("Error receiving block", {}, e);
    }
  } catch (e) {
    if (
      e instanceof BlockError &&
      (e.type.code === BlockErrorCode.FUTURE_SLOT || e.type.code === BlockErrorCode.PARENT_UNKNOWN)
    ) {
      chain.receiveBlock(signedBlock);
    }

    throw e;
  }
}
