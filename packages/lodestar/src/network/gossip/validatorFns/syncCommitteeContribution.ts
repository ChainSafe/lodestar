import {altair} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {GossipValidationError} from "../errors";
import {GossipAction, IContributionAndProofJob, SyncCommitteeError} from "../../../chain/errors";
import {validateSyncCommitteeGossipContributionAndProof} from "../../../chain/validation/syncCommitteeContributionAndProof";
import {GossipTopic, IObjectValidatorModules} from "../interface";

/**
 * Validate messages from `sync_committee_contribution_and_proof`
 */
export async function validateSyncCommitteeContribution(
  {chain, db, logger}: IObjectValidatorModules,
  _topic: GossipTopic,
  contributionAndProof: altair.SignedContributionAndProof
): Promise<void> {
  const metadata = {slot: contributionAndProof.message.contribution.slot};
  try {
    const contributionAndProofJob: IContributionAndProofJob = {contributionAndProof, validSignature: false};
    await validateSyncCommitteeGossipContributionAndProof(chain, db, contributionAndProofJob);
    logger.debug("gossip - sync_committee_contribution_and_proof - accept", metadata);
  } catch (e) {
    if (!(e instanceof SyncCommitteeError)) {
      logger.error("gossip - sync_committee_contribution_and_proof - non-SyncCommitteeError", metadata, e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }

    if (e.action === GossipAction.REJECT) {
      logger.debug("gossip - sync_committee_contribution_and_proof - reject", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
    } else {
      logger.debug("gossip - sync_committee_contribution_and_proof - ignore", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  }
}
