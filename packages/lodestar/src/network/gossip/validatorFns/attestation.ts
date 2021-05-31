import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {phase0} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {IAttestationJob} from "../../../chain";
import {validateGossipAttestation} from "../../../chain/validation";
import {AttestationGossipError, AttestationErrorCode, GossipAction} from "../../../chain/errors";
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
    if (!(e instanceof AttestationGossipError)) {
      logger.error("gossip - attestation - non-AttestationError", e);
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
      logger.debug("gossip - attestation - reject", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
    } else {
      logger.debug("gossip - attestation - ignore", e.type as Json);
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
    }
  } finally {
    db.seenAttestationCache.addCommitteeAttestation(attestation);
  }
}
