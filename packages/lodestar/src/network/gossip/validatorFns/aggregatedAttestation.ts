import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {phase0} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {validateGossipAggregateAndProof} from "../../../chain/validation";
import {AttestationError, AttestationErrorCode} from "../../../chain/errors";
import {IObjectValidatorModules, GossipTopic} from "../interface";
import {GossipValidationError} from "../errors";
import {OpSource} from "../../../metrics/validatorMonitor";

export async function validateAggregatedAttestation(
  {chain, logger, metrics}: IObjectValidatorModules,
  _topic: GossipTopic,
  signedAggregateAndProof: phase0.SignedAggregateAndProof
): Promise<void> {
  const seenTimestampSec = Date.now() / 1000;

  try {
    const indexedAtt = await validateGossipAggregateAndProof(chain, signedAggregateAndProof);
    logger.debug("gossip - AggregateAndProof - accept");

    metrics?.registerAggregatedAttestation(OpSource.gossip, seenTimestampSec, signedAggregateAndProof, indexedAtt);
  } catch (e) {
    if (!(e instanceof AttestationError)) {
      logger.error("Gossip aggregate and proof validation threw a non-AttestationError", e);
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
      case AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS:
      case AttestationErrorCode.KNOWN_BAD_BLOCK:
      case AttestationErrorCode.AGGREGATOR_NOT_IN_COMMITTEE:
      case AttestationErrorCode.INVALID_SIGNATURE:
      case AttestationErrorCode.INVALID_AGGREGATOR:
      case AttestationErrorCode.INVALID_INDEXED_ATTESTATION:
        logger.debug("gossip - AggregateAndProof - reject", e.type);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);

      case AttestationErrorCode.FUTURE_SLOT: // IGNORE
      case AttestationErrorCode.PAST_SLOT:
      case AttestationErrorCode.AGGREGATOR_ALREADY_KNOWN:
      case AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE:
      default:
        logger.debug("gossip - AggregateAndProof - ignore", e.type as Json);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  }
}
