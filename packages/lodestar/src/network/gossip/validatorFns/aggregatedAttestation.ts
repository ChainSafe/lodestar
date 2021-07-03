import {phase0} from "@chainsafe/lodestar-types";
import {validateGossipAggregateAndProof} from "../../../chain/validation";
import {IObjectValidatorModules, GossipTopic} from "../interface";
import {OpSource} from "../../../metrics/validatorMonitor";

export async function validateAggregatedAttestation(
  {chain, db, metrics, logger}: IObjectValidatorModules,
  _topic: GossipTopic,
  signedAggregateAndProof: phase0.SignedAggregateAndProof
): Promise<void> {
  const seenTimestampSec = Date.now() / 1000;

  const indexedAtt = await validateGossipAggregateAndProof(chain, signedAggregateAndProof);

  metrics?.registerAggregatedAttestation(OpSource.gossip, seenTimestampSec, signedAggregateAndProof, indexedAtt);

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

  // Handler

  db.aggregateAndProof.add(signedAggregateAndProof.message).catch((e) => {
    logger.error("Error adding aggregateAndProof to pool", {}, e);
  });
}
