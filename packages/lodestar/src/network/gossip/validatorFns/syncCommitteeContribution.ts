import {altair} from "@chainsafe/lodestar-types";
import {validateSyncCommitteeGossipContributionAndProof} from "../../../chain/validation/syncCommitteeContributionAndProof";
import {GossipTopic, IObjectValidatorModules} from "../interface";

/**
 * Validate messages from `sync_committee_contribution_and_proof`
 */
export async function validateSyncCommitteeContribution(
  {chain, db}: IObjectValidatorModules,
  _topic: GossipTopic,
  contributionAndProof: altair.SignedContributionAndProof
): Promise<void> {
  await validateSyncCommitteeGossipContributionAndProof(chain, db, contributionAndProof);
}
