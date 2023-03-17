import {toHexString} from "@chainsafe/ssz";
import {UnknownBlockFns as UnknownBlockFromGossipObjectFns, GossipType} from "../gossip/index.js";

export function createUnknownBlockFromGossipObjectFns(): UnknownBlockFromGossipObjectFns {
  const neverReturn = (): never => {
    throw Error("Not expect this gossip message to return an unknown block");
  };
  return {
    [GossipType.beacon_attestation]: (attestation) => {
      const {slot, beaconBlockRoot} = attestation.data;
      return {
        slot,
        root: toHexString(beaconBlockRoot),
      };
    },
    [GossipType.beacon_aggregate_and_proof]: (signedAggregateAndProof) => {
      const {slot, beaconBlockRoot} = signedAggregateAndProof.message.aggregate.data;
      return {
        slot,
        root: toHexString(beaconBlockRoot),
      };
    },
    [GossipType.sync_committee]: neverReturn,
    [GossipType.sync_committee_contribution_and_proof]: neverReturn,
    [GossipType.beacon_block]: neverReturn,
    [GossipType.beacon_block_and_blobs_sidecar]: neverReturn,
    [GossipType.attester_slashing]: neverReturn,
    [GossipType.proposer_slashing]: neverReturn,
    [GossipType.voluntary_exit]: neverReturn,
    [GossipType.bls_to_execution_change]: neverReturn,
    [GossipType.light_client_finality_update]: neverReturn,
    [GossipType.light_client_optimistic_update]: neverReturn,
  };
}
