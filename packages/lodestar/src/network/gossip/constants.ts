/**
 * @module network/gossip
 */

import {CommitteeIndex} from "@chainsafe/eth2.0-types";
import {ATTESTATION_SUBNET_COUNT} from "../../constants";

export enum GossipEvent {
  BLOCK = "/eth2/beacon_block",
  AGGREGATE_AND_PROOF = "/eth2/beacon_aggregate_and_proof",
  ATTESTATION = "/eth2/beacon_attestation",
  ATTESTATION_SUBNET = "/eth2/committee_index{subnet}_beacon_attestation",
  VOLUNTARY_EXIT = "/eth2/voluntary_exit",
  PROPOSER_SLASHING = "/eth2/proposer_slashing",
  ATTESTER_SLASHING = "/eth2/attester_slashing"
}

export const AttestationSubnetTopicPrefix = "/eth2/committee_index";
export const AttestationSubnetTopicSuffix = "_beacon_attestation";

export const AttestationSubnetRegExp = new RegExp("^/eth2/committee_index[0-9]+_beacon_attestation/[a-z]+$");

export function getCommitteeSubnetEvent(index: CommitteeIndex): string {
  return GossipEvent.ATTESTATION_SUBNET.replace("{subnet}", String(index % ATTESTATION_SUBNET_COUNT));
}
