import {altair} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {GossipType, GossipValidationError} from "../../../../src/network/gossip";
import {ISyncCommitteeJob, SyncCommitteeError, SyncCommitteeErrorCode} from "../../../chain/errors/syncCommitteeError";
import {validateGossipSyncCommittee} from "../../../chain/validation/syncCommittee";
import {GossipTopicMap, IObjectValidatorModules} from "../interface";

export async function validateSyncCommittee(
  {chain, db, config, logger}: IObjectValidatorModules,
  topic: GossipTopicMap[GossipType.sync_committee],
  syncCommittee: altair.SyncCommitteeSignature
): Promise<void> {
  const subnet = topic.subnet;

  try {
    const syncCommitteeJob: ISyncCommitteeJob = {
      syncCommittee: syncCommittee,
      validSignature: false,
    };
    await validateGossipSyncCommittee(config, chain, db, syncCommitteeJob, subnet);
    logger.debug("gossip - SynCommitteeSignature - accept", {subnet});
  } catch (e) {
    if (!(e instanceof SyncCommitteeError)) {
      logger.error("Gossip sync committee validation threw a non-SyncCommitteeError", e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
    switch (e.type.code) {
      case SyncCommitteeErrorCode.INVALID_SUBNET_ID:
      case SyncCommitteeErrorCode.INVALID_SIGNATURE:
        logger.debug("gossip - SyncCommittee - reject", e.type);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
      case SyncCommitteeErrorCode.PAST_SLOT:
      case SyncCommitteeErrorCode.FUTURE_SLOT:
      case SyncCommitteeErrorCode.UNKNOWN_BEACON_BLOCK_ROOT:
      case SyncCommitteeErrorCode.SYNC_COMMITTEE_ALREADY_KNOWN:
      default:
        logger.debug("gossip - SyncCommittee - ignore", e.type as Json);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  }
}
