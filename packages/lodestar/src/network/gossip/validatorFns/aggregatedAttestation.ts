import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {phase0} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {validateGossipAggregateAndProof} from "../../../chain/validation";
import {AttestationError, AttestationErrorCode} from "../../../chain/errors";
import {IObjectValidatorModules, GossipTopic} from "../interface";
import {GossipValidationError} from "../errors";

export async function validateAggregatedAttestation(
  {chain, db, config, logger}: IObjectValidatorModules,
  _topic: GossipTopic,
  signedAggregateAndProof: phase0.SignedAggregateAndProof
): Promise<void> {
  const attestation = signedAggregateAndProof.message.aggregate;

  try {
    await validateGossipAggregateAndProof(config, chain, db, signedAggregateAndProof, {
      attestation: attestation,
      validSignature: false,
    });
    logger.debug("gossip - AggregateAndProof - accept");
  } catch (e) {
    if (!(e instanceof AttestationError)) {
      logger.error("Gossip aggregate and proof validation threw a non-AttestationError", e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }

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
        chain.receiveAttestation(attestation);
      /** eslit-disable-next-line no-fallthrough */
      case AttestationErrorCode.PAST_SLOT:
      case AttestationErrorCode.AGGREGATE_ALREADY_KNOWN:
      case AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE:
      default:
        logger.debug("gossip - AggregateAndProof - ignore", e.type as Json);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  } finally {
    db.seenAttestationCache.addAggregateAndProof(signedAggregateAndProof.message);
  }
}
