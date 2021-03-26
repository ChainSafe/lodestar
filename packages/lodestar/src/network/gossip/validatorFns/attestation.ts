import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {phase0} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {IAttestationJob} from "../../../chain";
import {validateGossipAttestation} from "../../../chain/validation";
import {AttestationError, AttestationErrorCode} from "../../../chain/errors";
import {IObjectValidatorModules, GossipTopicMap, GossipType} from "../interface";
import {GossipValidationError} from "../errors";

export async function validateCommitteeAttestation(
  {chain, db, config, logger}: IObjectValidatorModules,
  topic: GossipTopicMap[GossipType.beacon_attestation],
  attestation: phase0.Attestation
): Promise<void> {
  const subnet = topic.subnet;

  try {
    const attestationJob: IAttestationJob = {
      attestation,
      validSignature: false,
    };

    await validateGossipAttestation(config, chain, db, attestationJob, subnet);
    logger.debug("gossip - Attestation - accept", {subnet});
  } catch (e) {
    if (!(e instanceof AttestationError)) {
      logger.error("Gossip attestation validation threw a non-AttestationError", e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
    switch (e.type.code) {
      case AttestationErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE:
      case AttestationErrorCode.INVALID_SUBNET_ID:
      case AttestationErrorCode.BAD_TARGET_EPOCH:
      case AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET:
      case AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS:
      case AttestationErrorCode.INVALID_SIGNATURE:
      case AttestationErrorCode.KNOWN_BAD_BLOCK:
      case AttestationErrorCode.FINALIZED_CHECKPOINT_NOT_AN_ANCESTOR_OF_ROOT:
      case AttestationErrorCode.TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK:
        logger.debug("gossip - Attestation - reject", e.type);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);

      case AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT:
      case AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE: // IGNORE
        // attestation might be valid after we receive block
        chain.receiveAttestation(attestation);
      /** eslit-disable-next-line no-fallthrough */
      case AttestationErrorCode.PAST_SLOT:
      case AttestationErrorCode.FUTURE_SLOT:
      case AttestationErrorCode.ATTESTATION_ALREADY_KNOWN:
      default:
        logger.debug("gossip - Attestation - ignore", e.type as Json);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  } finally {
    db.seenAttestationCache.addCommitteeAttestation(attestation);
  }
}
