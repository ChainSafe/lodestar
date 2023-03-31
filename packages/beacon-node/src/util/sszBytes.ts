import {RootHex, Slot} from "@lodestar/types";
import {toHex} from "@lodestar/utils";

export type BlockRootHex = RootHex;
export type AttDataHash = string;

// class Attestation(Container):
//   aggregation_bits: Bitlist[MAX_VALIDATORS_PER_COMMITTEE] - offset 4
//   data: AttestationData - target data
//   signature: BLSSignature
//
// class AttestationData(Container): 128 bytes fixed size
//   slot: Slot                - data 8
//   index: CommitteeIndex     - data 8
//   beacon_block_root: Root   - data 32
//   source: Checkpoint        - data 40
//   target: Checkpoint        - data 40
//
// class SignedAggregateAndProof(Container):
//    message: AggregateAndProof - offset 4
//    signature: BLSSignature    - data 96

// class AggregateAndProof(Container)
//    aggregatorIndex: ValidatorIndex - data 8
//    aggregate: Attestation          - offset 4
//    selectionProof: BLSSignature    - data 96

const ATTESTATION_SLOT_OFFSET = 4;
const ATTESTATION_BEACON_BLOCK_ROOT_OFFSET = ATTESTATION_SLOT_OFFSET + 8 + 8;
const ROOT_SIZE = 32;

export function getSlotFromAttestationSerialized(data: Uint8Array): Slot {
  return getSlotFromOffset(data, ATTESTATION_SLOT_OFFSET);
}

export function getBlockRootFromAttestationSerialized(data: Uint8Array): BlockRootHex {
  return toHex(data.subarray(ATTESTATION_BEACON_BLOCK_ROOT_OFFSET, ATTESTATION_BEACON_BLOCK_ROOT_OFFSET + ROOT_SIZE));
}

export function getAttDataHashFromAttestationSerialized(data: Uint8Array): AttDataHash {
  // base64 is a bit efficient than hex
  return Buffer.from(data.slice(ATTESTATION_SLOT_OFFSET, ATTESTATION_SLOT_OFFSET + 128)).toString("base64");
}

const AGGREGATE_AND_PROOF_OFFSET = 4 + 96;
const AGGREGATE_OFFSET = AGGREGATE_AND_PROOF_OFFSET + 8 + 4 + 96;
const SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET = AGGREGATE_OFFSET + ATTESTATION_SLOT_OFFSET;
const SIGNED_AGGREGATE_AND_PROOF_BLOCK_ROOT_OFFSET = SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET + 8 + 8;

export function getSlotFromSignedAggregateAndProofSerialized(data: Uint8Array): Slot {
  return getSlotFromOffset(data, SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET);
}

export function getBlockRootFromSignedAggregateAndProofSerialized(data: Uint8Array): BlockRootHex {
  return toHex(
    data.subarray(
      SIGNED_AGGREGATE_AND_PROOF_BLOCK_ROOT_OFFSET,
      SIGNED_AGGREGATE_AND_PROOF_BLOCK_ROOT_OFFSET + ROOT_SIZE
    )
  );
}

export function getAttDataHashFromSignedAggregateAndProofSerialized(data: Uint8Array): AttDataHash {
  // base64 is a bit efficient than hex
  return Buffer.from(
    data.slice(SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET, SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET + 128)
  ).toString("base64");
}

function getSlotFromOffset(data: Uint8Array, offset: number): Slot {
  // TODO: Optimize
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Read only the first 4 bytes of Slot, max value is 4,294,967,295 will be reached 1634 years after genesis
  return dv.getUint32(offset, true);
}
