import {phase0} from "@chainsafe/lodestar-types";
import {validateGossipAttestation} from "../../../chain/validation";
import {IObjectValidatorModules, GossipTopicMap, GossipType} from "../interface";
import {OpSource} from "../../../metrics/validatorMonitor";

export async function validateCommitteeAttestation(
  {chain, metrics}: IObjectValidatorModules,
  topic: GossipTopicMap[GossipType.beacon_attestation],
  attestation: phase0.Attestation
): Promise<void> {
  const seenTimestampSec = Date.now() / 1000;

  const {indexedAttestation} = await validateGossipAttestation(chain, attestation, topic.subnet);

  metrics?.registerUnaggregatedAttestation(OpSource.gossip, seenTimestampSec, indexedAttestation);
}
