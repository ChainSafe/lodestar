import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {phase0} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {validateGossipAggregateAndProof} from "../../../chain/validation";
import {AttestationGossipError, AttestationErrorCode, GossipAction} from "../../../chain/errors";
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
    if (!(e instanceof AttestationGossipError)) {
      logger.error("gossip - AggregateAndProof - non-AttestationError", e);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }

    if (
      e.type.code === AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT ||
      e.type.code === AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE
    ) {
      // attestation might be valid after we receive block
      chain.receiveAttestation(attestation);
    }

    if (e.action === GossipAction.REJECT) {
      logger.debug("gossip - AggregateAndProof - reject", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
    } else {
      logger.debug("gossip - AggregateAndProof - ignore", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  } finally {
    db.seenAttestationCache.addAggregateAndProof(signedAggregateAndProof.message);
  }
}
