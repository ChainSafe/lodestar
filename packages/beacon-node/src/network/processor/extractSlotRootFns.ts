import {ForkName, isForkPostGloas} from "@lodestar/params";
import {SlotOptionalRoot, SlotRootHex} from "@lodestar/types";
import {
  getBeaconBlockRootFromDataColumnSidecarSerialized,
  getBlockRootFromBeaconAttestationSerialized,
  getBlockRootFromSignedAggregateAndProofSerialized,
  getBlockRootFromSignedExecutionPayloadEnvelopeSerialized,
  getSlotFromBeaconAttestationSerialized,
  getSlotFromBlobSidecarSerialized,
  getSlotFromDataColumnSidecarSerialized,
  getSlotFromSignedAggregateAndProofSerialized,
  getSlotFromSignedBeaconBlockSerialized,
  getSlotFromSignedExecutionPayloadEnvelopeSerialized,
} from "../../util/sszBytes.js";
import {GossipType} from "../gossip/index.js";
import {ExtractSlotRootFns} from "./types.js";

/**
 * Extract the slot and block root of a gossip message form serialized data.
 * Not applicable for all topics.
 */
export function createExtractBlockSlotRootFns(): ExtractSlotRootFns {
  return {
    [GossipType.beacon_attestation]: (data: Uint8Array, fork: ForkName): SlotRootHex | null => {
      const slot = getSlotFromBeaconAttestationSerialized(fork, data);
      const root = getBlockRootFromBeaconAttestationSerialized(fork, data);

      if (slot === null || root === null) {
        return null;
      }
      return {slot, root};
    },
    [GossipType.beacon_aggregate_and_proof]: (data: Uint8Array): SlotRootHex | null => {
      const slot = getSlotFromSignedAggregateAndProofSerialized(data);
      const root = getBlockRootFromSignedAggregateAndProofSerialized(data);

      if (slot === null || root === null) {
        return null;
      }
      return {slot, root};
    },
    [GossipType.beacon_block]: (data: Uint8Array): SlotOptionalRoot | null => {
      const slot = getSlotFromSignedBeaconBlockSerialized(data);

      if (slot === null) {
        return null;
      }
      return {slot};
    },
    [GossipType.blob_sidecar]: (data: Uint8Array): SlotOptionalRoot | null => {
      const slot = getSlotFromBlobSidecarSerialized(data);

      if (slot === null) {
        return null;
      }
      return {slot};
    },
    [GossipType.data_column_sidecar]: (data: Uint8Array, fork: ForkName): SlotOptionalRoot | null => {
      const slot = getSlotFromDataColumnSidecarSerialized(data, fork);
      if (slot === null) {
        return null;
      }

      const root = isForkPostGloas(fork) ? getBeaconBlockRootFromDataColumnSidecarSerialized(data) : null;
      return root !== null ? {slot, root} : {slot};
    },
    [GossipType.execution_payload]: (data: Uint8Array): SlotRootHex | null => {
      const slot = getSlotFromSignedExecutionPayloadEnvelopeSerialized(data);
      const root = getBlockRootFromSignedExecutionPayloadEnvelopeSerialized(data);

      if (slot === null || root === null) {
        return null;
      }
      return {slot, root};
    },
  };
}
