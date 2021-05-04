import {altair} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {GossipValidationError} from "..";
import {
  IContributionAndProofJob,
  SyncCommitteeError,
  SyncCommitteeErrorCode,
} from "../../../chain/errors/syncCommitteeError";
import {validateGossipContributionAndProof} from "../../../chain/validation/contributionAndProof";
import {GossipTopic, IObjectValidatorModules} from "../interface";

export async function validateSyncCommitteeContribution(
  {chain, db, config, logger}: IObjectValidatorModules,
  _topic: GossipTopic,
  contributionAndProof: altair.SignedContributionAndProof
): Promise<void> {
  try {
    const contributionAndProofJob: IContributionAndProofJob = {
      contributionAndProof: contributionAndProof,
      validSignature: false,
    };
    await validateGossipContributionAndProof(config, chain, db, contributionAndProofJob);
    logger.debug("gossip - ContributionAndProof - accept", {slot: contributionAndProof.message.contribution.slot});
  } catch (e) {
    if (!(e instanceof SyncCommitteeError)) {
      logger.error("Gossip contribution and proof validation threw a non-SyncCommitteeError", e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }

    switch (e.type.code) {
      case SyncCommitteeErrorCode.INVALID_SUB_COMMITTEE_INDEX:
      case SyncCommitteeErrorCode.INVALID_AGGREGATOR:
      case SyncCommitteeErrorCode.INVALID_SIGNATURE:
        logger.debug("gossip - ContributionAndProof - reject", e.type);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
      case SyncCommitteeErrorCode.PAST_SLOT:
      case SyncCommitteeErrorCode.FUTURE_SLOT:
      case SyncCommitteeErrorCode.UNKNOWN_BEACON_BLOCK_ROOT:
      case SyncCommitteeErrorCode.SYNC_COMMITTEE_ALREADY_KNOWN:
      default:
        logger.debug("gossip - ContributionAndProof - ignore", e.type as Json);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  }
}
