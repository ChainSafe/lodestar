import {BitArray} from "@chainsafe/ssz";
import {BLSSignature, RootHex, Slot} from "@lodestar/types";
import {toHex} from "@lodestar/utils";

export type BlockRootHex = RootHex;
export type AttDataBase64 = string;

// class Attestation(Container):
//   aggregation_bits: Bitlist[MAX_VALIDATORS_PER_COMMITTEE] - offset 4
//   data: AttestationData - target data - 128
//   signature: BLSSignature - 96
//
// class AttestationData(Container): 128 bytes fixed size
//   slot: Slot                - data 8
//   index: CommitteeIndex     - data 8
//   beacon_block_root: Root   - data 32
//   source: Checkpoint        - data 40
//   target: Checkpoint        - data 40

const VARIABLE_FIELD_OFFSET = 4;
const ATTESTATION_BEACON_BLOCK_ROOT_OFFSET = VARIABLE_FIELD_OFFSET + 8 + 8;
const ROOT_SIZE = 32;
const SLOT_SIZE = 8;
const ATTESTATION_DATA_SIZE = 128;
const SIGNATURE_SIZE = 96;

/**
 * Extract slot from attestation serialized bytes.
 * Return null if data is not long enough to extract slot.
 */
export function getSlotFromAttestationSerialized(data: Uint8Array): Slot | null {
  if (data.length < VARIABLE_FIELD_OFFSET + SLOT_SIZE) {
    return null;
  }

  return getSlotFromOffset(data, VARIABLE_FIELD_OFFSET);
}

/**
 * Extract block root from attestation serialized bytes.
 * Return null if data is not long enough to extract block root.
 */
export function getBlockRootFromAttestationSerialized(data: Uint8Array): BlockRootHex | null {
  if (data.length < ATTESTATION_BEACON_BLOCK_ROOT_OFFSET + ROOT_SIZE) {
    return null;
  }

  return toHex(data.subarray(ATTESTATION_BEACON_BLOCK_ROOT_OFFSET, ATTESTATION_BEACON_BLOCK_ROOT_OFFSET + ROOT_SIZE));
}

/**
 * Extract attestation data base64 from attestation serialized bytes.
 * Return null if data is not long enough to extract attestation data.
 */
export function getAttDataBase64FromAttestationSerialized(data: Uint8Array): AttDataBase64 | null {
  if (data.length < VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE) {
    return null;
  }

  // base64 is a bit efficient than hex
  return Buffer.from(data.slice(VARIABLE_FIELD_OFFSET, VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE)).toString(
    "base64"
  );
}

/**
 * Extract aggregation bits from attestation serialized bytes.
 * Return null if data is not long enough to extract aggregation bits.
 */
export function getAggregationBitsFromAttestationSerialized(data: Uint8Array): BitArray | null {
  if (data.length < VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE + SIGNATURE_SIZE) {
    return null;
  }

  const {uint8Array, bitLen} = deserializeUint8ArrayBitListFromBytes(
    data,
    VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE + SIGNATURE_SIZE,
    data.length
  );
  return new BitArray(uint8Array, bitLen);
}

/**
 * Extract signature from attestation serialized bytes.
 * Return null if data is not long enough to extract signature.
 */
export function getSignatureFromAttestationSerialized(data: Uint8Array): BLSSignature | null {
  if (data.length < VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE + SIGNATURE_SIZE) {
    return null;
  }

  return data.subarray(
    VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE,
    VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE + SIGNATURE_SIZE
  );
}

//
// class SignedAggregateAndProof(Container):
//    message: AggregateAndProof - offset 4
//    signature: BLSSignature    - data 96

// class AggregateAndProof(Container)
//    aggregatorIndex: ValidatorIndex - data 8
//    aggregate: Attestation          - offset 4
//    selectionProof: BLSSignature    - data 96

const AGGREGATE_AND_PROOF_OFFSET = 4 + 96;
const AGGREGATE_OFFSET = AGGREGATE_AND_PROOF_OFFSET + 8 + 4 + 96;
const SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET = AGGREGATE_OFFSET + VARIABLE_FIELD_OFFSET;
const SIGNED_AGGREGATE_AND_PROOF_BLOCK_ROOT_OFFSET = SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET + 8 + 8;

/**
 * Extract slot from signed aggregate and proof serialized bytes.
 * Return null if data is not long enough to extract slot.
 */
export function getSlotFromSignedAggregateAndProofSerialized(data: Uint8Array): Slot | null {
  if (data.length < SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET + SLOT_SIZE) {
    return null;
  }

  return getSlotFromOffset(data, SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET);
}

/**
 * Extract block root from signed aggregate and proof serialized bytes.
 * Return null if data is not long enough to extract block root.
 */
export function getBlockRootFromSignedAggregateAndProofSerialized(data: Uint8Array): BlockRootHex | null {
  if (data.length < SIGNED_AGGREGATE_AND_PROOF_BLOCK_ROOT_OFFSET + ROOT_SIZE) {
    return null;
  }

  return toHex(
    data.subarray(
      SIGNED_AGGREGATE_AND_PROOF_BLOCK_ROOT_OFFSET,
      SIGNED_AGGREGATE_AND_PROOF_BLOCK_ROOT_OFFSET + ROOT_SIZE
    )
  );
}

/**
 * Extract attestation data base64 from signed aggregate and proof serialized bytes.
 * Return null if data is not long enough to extract attestation data.
 */
export function getAttDataBase64FromSignedAggregateAndProofSerialized(data: Uint8Array): AttDataBase64 | null {
  if (data.length < SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET + ATTESTATION_DATA_SIZE) {
    return null;
  }

  // base64 is a bit efficient than hex
  return Buffer.from(
    data.slice(SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET, SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET + ATTESTATION_DATA_SIZE)
  ).toString("base64");
}

/**
 * 4 + 96 = 100
 * ```
 * class SignedBeaconBlock(Container):
 *   message: BeaconBlock [offset - 4 bytes]
 *   signature: BLSSignature [fixed - 96 bytes]
 *
 * class BeaconBlock(Container):
 *   slot: Slot [fixed - 8 bytes]
 *   proposer_index: ValidatorIndex
 *   parent_root: Root
 *   state_root: Root
 *   body: BeaconBlockBody
 * ```
 */
const SLOT_BYTES_POSITION_IN_SIGNED_BEACON_BLOCK = VARIABLE_FIELD_OFFSET + SIGNATURE_SIZE;

export function getSlotFromSignedBeaconBlockSerialized(data: Uint8Array): Slot | null {
  if (data.length < SLOT_BYTES_POSITION_IN_SIGNED_BEACON_BLOCK + SLOT_SIZE) {
    return null;
  }

  return getSlotFromOffset(data, SLOT_BYTES_POSITION_IN_SIGNED_BEACON_BLOCK);
}

/**
 * 4 + 4 + SLOT_BYTES_POSITION_IN_SIGNED_BEACON_BLOCK = 4 + 4 + (4 + 96) = 108
 * class SignedBeaconBlockAndBlobsSidecar(Container):
 *  beaconBlock: SignedBeaconBlock [offset - 4 bytes]
 *  blobsSidecar: BlobsSidecar,
 */

/**
 * Variable size.
 * class BlobsSidecar(Container):
 *   beaconBlockRoot: Root,
 *   beaconBlockSlot: Slot,
 *   blobs: Blobs,
 *   kzgAggregatedProof: KZGProof,
 */
const SLOT_BYTES_POSITION_IN_SIGNED_BEACON_BLOCK_AND_BLOBS_SIDECAR =
  VARIABLE_FIELD_OFFSET + VARIABLE_FIELD_OFFSET + SLOT_BYTES_POSITION_IN_SIGNED_BEACON_BLOCK;

export function getSlotFromSignedBeaconBlockAndBlobsSidecarSerialized(data: Uint8Array): Slot | null {
  if (data.length < SLOT_BYTES_POSITION_IN_SIGNED_BEACON_BLOCK_AND_BLOBS_SIDECAR + SLOT_SIZE) {
    return null;
  }

  return getSlotFromOffset(data, SLOT_BYTES_POSITION_IN_SIGNED_BEACON_BLOCK_AND_BLOBS_SIDECAR);
}

function getSlotFromOffset(data: Uint8Array, offset: number): Slot {
  // TODO: Optimize
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Read only the first 4 bytes of Slot, max value is 4,294,967,295 will be reached 1634 years after genesis
  return dv.getUint32(offset, true);
}

type BitArrayDeserialized = {uint8Array: Uint8Array; bitLen: number};

/**
 * This is copied from ssz bitList.ts
 * TODO: export this util from there
 */
function deserializeUint8ArrayBitListFromBytes(data: Uint8Array, start: number, end: number): BitArrayDeserialized {
  if (end > data.length) {
    throw Error(`BitList attempting to read byte ${end} of data length ${data.length}`);
  }

  const lastByte = data[end - 1];
  const size = end - start;

  if (lastByte === 0) {
    throw new Error("Invalid deserialized bitlist, padding bit required");
  }

  if (lastByte === 1) {
    // Buffer.prototype.slice does not copy memory, Enforce Uint8Array usage https://github.com/nodejs/node/issues/28087
    const uint8Array = Uint8Array.prototype.slice.call(data, start, end - 1);
    const bitLen = (size - 1) * 8;
    return {uint8Array, bitLen};
  }

  // the last byte is > 1, so a padding bit will exist in the last byte and need to be removed
  // Buffer.prototype.slice does not copy memory, Enforce Uint8Array usage https://github.com/nodejs/node/issues/28087
  const uint8Array = Uint8Array.prototype.slice.call(data, start, end);
  // mask lastChunkByte
  const lastByteBitLength = lastByte.toString(2).length - 1;
  const bitLen = (size - 1) * 8 + lastByteBitLength;
  const mask = 0xff >> (8 - lastByteBitLength);
  uint8Array[size - 1] &= mask;
  return {uint8Array, bitLen};
}
