import {SlotRootHex} from "@lodestar/types";
import {getBlockRootFromAttestationSerialized, getSlotFromAttestationSerialized} from "../../util/sszBytes.js";
import {GossipType} from "../gossip/index.js";
import {ExtractSlotRootFns} from "./types.js";

// need unit tests for this function to verify it works as expected
export function createExtractSlotRootFns(): ExtractSlotRootFns {
  return {
    [GossipType.beacon_attestation]: (data: Uint8Array): SlotRootHex => {
      return {
        slot: getSlotFromAttestationSerialized(data),
        root: getBlockRootFromAttestationSerialized(data),
      };
    },
    // TODO
    // [GossipType.beacon_aggregate_and_proof]: returnNull,
  };
}
