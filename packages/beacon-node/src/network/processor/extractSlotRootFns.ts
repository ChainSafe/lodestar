import {ForkName, ForkSeq} from "@lodestar/params";
import {SlotOptionalRoot, SlotRootHex} from "@lodestar/types";
import {
  getBeaconBlockRootFromDataColumnSidecarSerialized,
  getBeaconBlockRootFromFuluDataColumnSidecarSerialized,
  getBlockRootFromBeaconAttestationSerialized,
  getBlockRootFromPayloadAttestationMessageSerialized,
  getBlockRootFromSignedAggregateAndProofSerialized,
  getSlotFromBeaconAttestationSerialized,
  getSlotFromBlobSidecarSerialized,
  getSlotFromDataColumnSidecarSerialized,
  getSlotFromExecutionPayloadEnvelopeSerialized,
  getSlotFromPayloadAttestationMessageSerialized,
  getSlotFromSignedAggregateAndProofSerialized,
  getSlotFromSignedBeaconBlockSerialized,
  getSlotFromSignedExecutionPayloadBidSerialized,
} from "../../util/sszBytes.js";
import {GossipType} from "../gossip/index.js";
import {ExtractSlotRootFns} from "./types.js";

/**
 * Extract the slot and block root of a gossip message form serialized data.
 * Only do it for messages that have a slot and block root, and we want to await the block if the block root is not known.
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

      if (ForkSeq[fork] < ForkSeq.gloas) {
        const root = getBeaconBlockRootFromFuluDataColumnSidecarSerialized(data);
        return root !== null ? {slot, root} : {slot};
      }

      const root = getBeaconBlockRootFromDataColumnSidecarSerialized(data);
      // null root means the message is invalid here and will be ignored in gossip handler later
      // returning the slot here helps check the earliest permissable slot in the network processor
      return root !== null ? {slot, root} : {slot};
    },
    [GossipType.execution_payload]: (data: Uint8Array): SlotOptionalRoot | null => {
      const slot = getSlotFromExecutionPayloadEnvelopeSerialized(data);
      // Do not extract the root here; the network processor will extract it in the 2nd round to trigger block search without awaiting.
      if (slot === null) {
        return null;
      }
      return {slot};
    },
    [GossipType.payload_attestation_message]: (data: Uint8Array): SlotRootHex | null => {
      const slot = getSlotFromPayloadAttestationMessageSerialized(data);
      const root = getBlockRootFromPayloadAttestationMessageSerialized(data);

      if (slot === null || root === null) {
        return null;
      }
      return {slot, root};
    },
    [GossipType.execution_payload_bid]: (data: Uint8Array): SlotOptionalRoot | null => {
      const slot = getSlotFromSignedExecutionPayloadBidSerialized(data);

      if (slot === null) {
        return null;
      }

      return {slot};
    },
  };
}
