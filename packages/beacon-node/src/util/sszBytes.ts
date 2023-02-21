import {RootHex, Slot} from "@lodestar/types";

export type BlockRootHex = RootHex;
export type TargetHex = string;

// class Attestation(Container):
//   aggregation_bits: Bitlist[MAX_VALIDATORS_PER_COMMITTEE] - offset 4
//   data: AttestationData - target data
//   signature: BLSSignature
//
// class AttestationData(Container):
//   slot: Slot                - data 8
//   index: CommitteeIndex     - data 8
//   beacon_block_root: Root   - data 32
//   source: Checkpoint        - data 40
//   target: Checkpoint        - data 40
//
// class Checkpoint(Container):
//    epoch: Epoch
//    root: Root
const ATTESTATION_SLOT_OFFSET = 4;
const ATTESTATION_BEACON_BLOCK_ROOT_OFFSET = 4 + 8 + 8;
const ATTESTATION_TARGET_OFFSET = 4 + 8 + 8 + 32 + 40;
const ROOT_SIZE = 32;
const CHECKPOINT_SIZE = 40;

export function getSlotFromAttestationSerialized(data: Uint8Array): Slot {
  // TODO: Optimize
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Read only the first 4 bytes of Slot, max value is 4,294,967,295 will be reached 1634 years after genesis
  return dv.getUint32(ATTESTATION_SLOT_OFFSET, true);
}

export function getBlockRootFromAttestationSerialized(data: Uint8Array): BlockRootHex {
  return toHexNoPrefix(
    data.slice(ATTESTATION_BEACON_BLOCK_ROOT_OFFSET, ATTESTATION_BEACON_BLOCK_ROOT_OFFSET + ROOT_SIZE)
  );
}

export function getTargetFromAttestationSerialized(data: Uint8Array): TargetHex {
  return toHexNoPrefix(data.slice(ATTESTATION_TARGET_OFFSET, ATTESTATION_TARGET_OFFSET + CHECKPOINT_SIZE));
}

export function toHexNoPrefix(data: Uint8Array): string {
  return Buffer.from(data).toString("hex");
}
