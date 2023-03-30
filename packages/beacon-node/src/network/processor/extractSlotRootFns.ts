import {SlotRootHex} from "@lodestar/types";
import {
  getBlockRootFromAttestationSerialized,
  getBlockRootFromSignedAggregateAndProofSerialized,
  getSlotFromAttestationSerialized,
  getSlotFromSignedAggregateAndProofSerialized,
} from "../../util/sszBytes.js";
import {GossipType} from "../gossip/index.js";
import {ExtractSlotRootFns as BlockSlotRootFns} from "./types.js";

export function createBlockSlotRootFns(): BlockSlotRootFns {
  return {
    [GossipType.beacon_attestation]: (data: Uint8Array): SlotRootHex => {
      return {
        slot: getSlotFromAttestationSerialized(data),
        root: getBlockRootFromAttestationSerialized(data),
      };
    },
    [GossipType.beacon_aggregate_and_proof]: (data: Uint8Array): SlotRootHex => {
      return {
        slot: getSlotFromSignedAggregateAndProofSerialized(data),
        root: getBlockRootFromSignedAggregateAndProofSerialized(data),
      };
    },
  };
}
