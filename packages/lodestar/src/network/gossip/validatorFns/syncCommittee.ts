import {altair} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {GossipType, GossipValidationError} from "..";
import {GossipAction, ISyncCommitteeJob, SyncCommitteeError} from "../../../chain/errors";
import {validateGossipSyncCommittee} from "../../../chain/validation/syncCommittee";
import {GossipTopicMap, IObjectValidatorModules} from "../interface";

/**
 * Validate messages from `sync_committee_{subnet_id}` channels
 */
export async function validateSyncCommittee(
  {chain, db, logger}: IObjectValidatorModules,
  {subnet}: GossipTopicMap[GossipType.sync_committee],
  syncCommittee: altair.SyncCommitteeMessage
): Promise<void> {
  const metadata = {subnet, slot: syncCommittee.slot};
  try {
    const syncCommitteeJob: ISyncCommitteeJob = {signature: syncCommittee, validSignature: false};
    await validateGossipSyncCommittee(chain, db, syncCommitteeJob, subnet);
    logger.debug("gossip - sync_committee - accept", metadata);
  } catch (e) {
    if (!(e instanceof SyncCommitteeError)) {
      logger.error("gossip - sync_committee - non-SyncCommitteeError", metadata, e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }

    if (e.action === GossipAction.REJECT) {
      logger.debug("gossip - sync_committee - reject", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
    } else {
      logger.debug("gossip - sync_committee - ignore", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  }
}
