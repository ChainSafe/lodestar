import {
  getAttDataHashFromAttestationSerialized,
  getAttDataHashFromSignedAggregateAndProofSerialized,
} from "../../util/sszBytes.js";
import {GossipDataHashFns, GossipType} from "../gossip/interface.js";

export function getGossipDataHashFns(): GossipDataHashFns {
  return {
    [GossipType.beacon_attestation]: getAttDataHashFromAttestationSerialized,
    [GossipType.beacon_aggregate_and_proof]: getAttDataHashFromSignedAggregateAndProofSerialized,
  };
}
