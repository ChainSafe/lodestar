import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {phase0} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {validateGossipAttestation} from "../../../chain/validation";
import {AttestationError, AttestationErrorCode} from "../../../chain/errors";
import {IObjectValidatorModules, GossipTopicMap, GossipType} from "../interface";
import {GossipValidationError} from "../errors";
import {OpSource} from "../../../metrics/validatorMonitor";

export async function validateCommitteeAttestation(
  {chain, logger, metrics}: IObjectValidatorModules,
  topic: GossipTopicMap[GossipType.beacon_attestation],
  attestation: phase0.Attestation
): Promise<void> {
  const seenTimestampSec = Date.now() / 1000;
  const subnet = topic.subnet;

  try {
    const {indexedAttestation} = await validateGossipAttestation(chain, attestation, subnet);
    logger.debug("gossip - Attestation - accept", {subnet});

    metrics?.registerUnaggregatedAttestation(OpSource.gossip, seenTimestampSec, indexedAttestation);
  } catch (e) {
    if (!(e instanceof AttestationError)) {
      logger.error("Gossip attestation validation threw a non-AttestationError", e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }

    // TODO: Add DoS resistant pending attestation pool
    // switch (e.type.code) {
    //   case AttestationErrorCode.FUTURE_SLOT:
    //     chain.pendingAttestations.putBySlot(e.type.attestationSlot, attestation);
    //     break;
    //   case AttestationErrorCode.UNKNOWN_TARGET_ROOT:
    //   case AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT:
    //     chain.pendingAttestations.putByBlock(e.type.root, attestation);
    //     break;
    // }

    switch (e.type.code) {
      case AttestationErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE:
      case AttestationErrorCode.INVALID_SUBNET_ID:
      case AttestationErrorCode.BAD_TARGET_EPOCH:
      case AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET:
      case AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS:
      case AttestationErrorCode.INVALID_SIGNATURE:
      case AttestationErrorCode.KNOWN_BAD_BLOCK:
      case AttestationErrorCode.TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK:
        logger.debug("gossip - Attestation - reject", e.type);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);

      case AttestationErrorCode.PAST_SLOT:
      case AttestationErrorCode.FUTURE_SLOT:
      case AttestationErrorCode.ATTESTATION_ALREADY_KNOWN:
      default:
        logger.debug("gossip - Attestation - ignore", e.type as Json);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  }
}
