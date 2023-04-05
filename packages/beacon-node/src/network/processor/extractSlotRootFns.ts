import {SlotRootHex} from "@lodestar/types";
import {
  getBlockRootFromAttestationSerialized,
  getBlockRootFromSignedAggregateAndProofSerialized,
  getSlotFromAttestationSerialized,
  getSlotFromSignedAggregateAndProofSerialized,
} from "../../util/sszBytes.js";
import {nullableResult} from "../../util/wrapError.js";
import {GossipType} from "../gossip/index.js";
import {ExtractSlotRootFns} from "./types.js";

/**
 * Extract the slot and block root of a gossip message form serialized data.
 * Only applicable for beacon_attestation and beacon_aggregate_and_proof topics.
 */
export function createExtractBlockSlotRootFns(): ExtractSlotRootFns {
  return {
    [GossipType.beacon_attestation]: nullableResult(getSlotRootFromAttestationSerialized),
    [GossipType.beacon_aggregate_and_proof]: nullableResult(getSlotRootFromAggregateAndProofSerialized),
  };
}

function getSlotRootFromAttestationSerialized(data: Uint8Array): SlotRootHex {
  return {
    slot: getSlotFromAttestationSerialized(data),
    root: getBlockRootFromAttestationSerialized(data),
  };
}

function getSlotRootFromAggregateAndProofSerialized(data: Uint8Array): SlotRootHex {
  return {
    slot: getSlotFromSignedAggregateAndProofSerialized(data),
    root: getBlockRootFromSignedAggregateAndProofSerialized(data),
  };
}
