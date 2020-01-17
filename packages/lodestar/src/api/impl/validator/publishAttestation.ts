import {Attestation} from "@chainsafe/eth2.0-types";
import {IGossip} from "../../../network/gossip/interface";
import {AttestationOperations} from "../../../opPool/modules";

export async function publishAttestation(
  attestation: Attestation, gossip: IGossip, attestationOperations: AttestationOperations
): Promise<void> {
  await Promise.all([
    gossip.publishCommiteeAttestation(attestation),
    attestationOperations.receive(attestation)
  ]);
}