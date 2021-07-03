import {phase0} from "@chainsafe/lodestar-types";
import {validateGossipAttestation} from "../../../chain/validation";
import {IObjectValidatorModules, GossipTopicMap, GossipType} from "../interface";
import {OpSource} from "../../../metrics/validatorMonitor";

export async function validateCommitteeAttestation(
  {chain, metrics, logger}: IObjectValidatorModules,
  {subnet}: GossipTopicMap[GossipType.beacon_attestation],
  attestation: phase0.Attestation
): Promise<void> {
  const seenTimestampSec = Date.now() / 1000;

  const {indexedAttestation} = await validateGossipAttestation(chain, attestation, subnet);

  metrics?.registerUnaggregatedAttestation(OpSource.gossip, seenTimestampSec, indexedAttestation);

  // Handler

  try {
    chain.attestationPool.add(attestation);
  } catch (e) {
    logger.error("Error adding attestation to pool", {subnet}, e);
  }
}
