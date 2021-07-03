import {altair} from "@chainsafe/lodestar-types";
import {GossipType} from "..";
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
  const {indexInSubCommittee} = await validateGossipSyncCommittee(chain, db, syncCommittee, subnet);

  // Handler

  try {
    db.syncCommittee.add(subnet, syncCommittee, indexInSubCommittee);
  } catch (e) {
    logger.error("Error adding to syncCommittee pool", {subnet}, e);
  }
}
