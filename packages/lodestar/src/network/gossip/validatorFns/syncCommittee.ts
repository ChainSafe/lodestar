import {altair} from "@chainsafe/lodestar-types";
import {GossipType} from "..";
import {validateGossipSyncCommittee} from "../../../chain/validation/syncCommittee";
import {GossipTopicMap, IObjectValidatorModules} from "../interface";

/**
 * Validate messages from `sync_committee_{subnet_id}` channels
 */
export async function validateSyncCommittee(
  {chain, db}: IObjectValidatorModules,
  {subnet}: GossipTopicMap[GossipType.sync_committee],
  syncCommittee: altair.SyncCommitteeMessage
): Promise<void> {
  await validateGossipSyncCommittee(chain, db, syncCommittee, subnet);
}
