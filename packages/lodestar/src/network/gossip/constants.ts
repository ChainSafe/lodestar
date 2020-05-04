/**
 * @module network/gossip
 */

import {CommitteeIndex} from "@chainsafe/lodestar-types";
import {ATTESTATION_SUBNET_COUNT} from "../../constants";

export enum GossipEvent {
  BLOCK = "beacon_block",
  AGGREGATE_AND_PROOF = "beacon_aggregate_and_proof",
  ATTESTATION = "beacon_attestation",
  ATTESTATION_SUBNET = "committee_index{subnet}_beacon_attestation",
  VOLUNTARY_EXIT = "voluntary_exit",
  PROPOSER_SLASHING = "proposer_slashing",
  ATTESTER_SLASHING = "attester_slashing"
}

export const AttestationSubnetRegExp =
new RegExp("^(/eth2/)([a-f0-9]{8})(/committee_index)([0-9]+)(_beacon_attestation/)([a-z_]+)$");

export const GossipTopicRegExp = new RegExp("^(/eth2/)([a-f0-9]{8})/(\\w+)(/[a-z]+)");

export function getCommitteeSubnetEvent(index: CommitteeIndex): string {
  return GossipEvent.ATTESTATION_SUBNET.replace("{subnet}", String(index % ATTESTATION_SUBNET_COUNT));
}
