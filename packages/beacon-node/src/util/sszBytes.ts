import {BitArray, deserializeUint8ArrayBitListFromBytes} from "@chainsafe/ssz";
import {
  BYTES_PER_FIELD_ELEMENT,
  FIELD_ELEMENTS_PER_BLOB,
  ForkName,
  ForkSeq,
  MAX_COMMITTEES_PER_SLOT,
} from "@lodestar/params";
import {BLSSignature, RootHex, Slot} from "@lodestar/types";

export type BlockRootHex = RootHex;
// pre-electra, AttestationData is used to cache attestations
export type AttDataBase64 = string;
// electra, CommitteeBits
export type CommitteeBitsBase64 = string;

// pre-electra
// class Attestation(Container):
//   aggregation_bits: Bitlist[MAX_VALIDATORS_PER_COMMITTEE] - offset 4
//   data: AttestationData - target data - 128
//   signature: BLSSignature - 96

// electra
// class Attestation(Container):
//   aggregation_bits: BitList[MAX_VALIDATORS_PER_COMMITTEE * MAX_COMMITTEES_PER_SLOT] - offset 4
//   data: AttestationData - target data - 128
//   signature: BLSSignature - 96
//   committee_bits: BitVector[MAX_COMMITTEES_PER_SLOT]
//
// for all forks
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
// MAX_COMMITTEES_PER_SLOT is in bit, need to convert to byte
const COMMITTEE_BITS_SIZE = Math.max(Math.ceil(MAX_COMMITTEES_PER_SLOT / 8), 1);
const SIGNATURE_SIZE = 96;

// shared Buffers to convert bytes to hex/base64
const blockRootBuf = Buffer.alloc(ROOT_SIZE);
const attDataBuf = Buffer.alloc(ATTESTATION_DATA_SIZE);
const committeeBitsDataBuf = Buffer.alloc(COMMITTEE_BITS_SIZE);

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

  blockRootBuf.set(
    data.subarray(ATTESTATION_BEACON_BLOCK_ROOT_OFFSET, ATTESTATION_BEACON_BLOCK_ROOT_OFFSET + ROOT_SIZE)
  );
  return "0x" + blockRootBuf.toString("hex");
}

/**
 * Extract attestation data base64 from all forks' attestation serialized bytes.
 * Return null if data is not long enough to extract attestation data.
 */
export function getAttDataFromAttestationSerialized(data: Uint8Array): AttDataBase64 | null {
  if (data.length < VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE) {
    return null;
  }

  // base64 is a bit efficient than hex
  attDataBuf.set(data.subarray(VARIABLE_FIELD_OFFSET, VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE));
  return attDataBuf.toString("base64");
}

/**
 * Alias of `getAttDataFromAttestationSerialized` specifically for batch handling indexing in gossip queue
 */
export function getGossipAttestationIndex(data: Uint8Array): AttDataBase64 | null {
  return getAttDataFromAttestationSerialized(data);
}

/**
 * Extract aggregation bits from attestation serialized bytes.
 * Return null if data is not long enough to extract aggregation bits.
 */
export function getAggregationBitsFromAttestationSerialized(fork: ForkName, data: Uint8Array): BitArray | null {
  const aggregationBitsStartIndex =
    ForkSeq[fork] >= ForkSeq.electra
      ? VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE + SIGNATURE_SIZE + COMMITTEE_BITS_SIZE
      : VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE + SIGNATURE_SIZE;

  if (data.length < aggregationBitsStartIndex) {
    return null;
  }

  const {uint8Array, bitLen} = deserializeUint8ArrayBitListFromBytes(data, aggregationBitsStartIndex, data.length);
  return new BitArray(uint8Array, bitLen);
}

/**
 * Extract signature from attestation serialized bytes.
 * Return null if data is not long enough to extract signature.
 */
export function getSignatureFromAttestationSerialized(data: Uint8Array): BLSSignature | null {
  const signatureStartIndex = VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE;

  if (data.length < signatureStartIndex + SIGNATURE_SIZE) {
    return null;
  }

  return data.subarray(signatureStartIndex, signatureStartIndex + SIGNATURE_SIZE);
}

/**
 * Extract committee bits from Electra attestation serialized bytes.
 * Return null if data is not long enough to extract committee bits.
 */
export function getCommitteeBitsFromAttestationSerialized(data: Uint8Array): CommitteeBitsBase64 | null {
  const committeeBitsStartIndex = VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE + SIGNATURE_SIZE;

  if (data.length < committeeBitsStartIndex + COMMITTEE_BITS_SIZE) {
    return null;
  }

  committeeBitsDataBuf.set(data.subarray(committeeBitsStartIndex, committeeBitsStartIndex + COMMITTEE_BITS_SIZE));
  return committeeBitsDataBuf.toString("base64");
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
 * Extract slot from signed aggregate and proof serialized bytes
 * Return null if data is not long enough to extract slot
 * This works for both phase + electra
 */
export function getSlotFromSignedAggregateAndProofSerialized(data: Uint8Array): Slot | null {
  if (data.length < SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET + SLOT_SIZE) {
    return null;
  }

  return getSlotFromOffset(data, SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET);
}

/**
 * Extract block root from signed aggregate and proof serialized bytes
 * Return null if data is not long enough to extract block root
 * This works for both phase + electra
 */
export function getBlockRootFromSignedAggregateAndProofSerialized(data: Uint8Array): BlockRootHex | null {
  if (data.length < SIGNED_AGGREGATE_AND_PROOF_BLOCK_ROOT_OFFSET + ROOT_SIZE) {
    return null;
  }

  blockRootBuf.set(
    data.subarray(
      SIGNED_AGGREGATE_AND_PROOF_BLOCK_ROOT_OFFSET,
      SIGNED_AGGREGATE_AND_PROOF_BLOCK_ROOT_OFFSET + ROOT_SIZE
    )
  );
  return "0x" + blockRootBuf.toString("hex");
}

/**
 * Extract AttestationData base64 from SignedAggregateAndProof for electra
 * Return null if data is not long enough
 */
export function getAttDataFromSignedAggregateAndProofElectra(data: Uint8Array): AttDataBase64 | null {
  const startIndex = SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET;
  const endIndex = startIndex + ATTESTATION_DATA_SIZE;

  if (data.length < endIndex + SIGNATURE_SIZE + COMMITTEE_BITS_SIZE) {
    return null;
  }
  attDataBuf.set(data.subarray(startIndex, endIndex));
  return attDataBuf.toString("base64");
}

/**
 * Extract CommitteeBits base64 from SignedAggregateAndProof for electra
 * Return null if data is not long enough
 */
export function getCommitteeBitsFromSignedAggregateAndProofElectra(data: Uint8Array): CommitteeBitsBase64 | null {
  const startIndex = SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET + ATTESTATION_DATA_SIZE + SIGNATURE_SIZE;
  const endIndex = startIndex + COMMITTEE_BITS_SIZE;

  if (data.length < endIndex) {
    return null;
  }

  committeeBitsDataBuf.set(data.subarray(startIndex, endIndex));
  return committeeBitsDataBuf.toString("base64");
}

/**
 * Extract attestation data base64 from signed aggregate and proof serialized bytes.
 * Return null if data is not long enough to extract attestation data.
 */
export function getAttDataFromSignedAggregateAndProofPhase0(data: Uint8Array): AttDataBase64 | null {
  if (data.length < SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET + ATTESTATION_DATA_SIZE) {
    return null;
  }

  // base64 is a bit efficient than hex
  attDataBuf.set(
    data.subarray(
      SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET,
      SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET + ATTESTATION_DATA_SIZE
    )
  );
  return attDataBuf.toString("base64");
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
 * class BlobSidecar(Container):
 *  index: BlobIndex [fixed - 8 bytes ],
 *  blob: Blob, BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_BLOB
 *  kzgCommitment: Bytes48,
 *  kzgProof: Bytes48,
 *  signedBlockHeader:
 *    slot: 8 bytes
 */

const SLOT_BYTES_POSITION_IN_SIGNED_BLOB_SIDECAR = 8 + BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_BLOB + 48 + 48;

export function getSlotFromBlobSidecarSerialized(data: Uint8Array): Slot | null {
  if (data.length < SLOT_BYTES_POSITION_IN_SIGNED_BLOB_SIDECAR + SLOT_SIZE) {
    return null;
  }

  return getSlotFromOffset(data, SLOT_BYTES_POSITION_IN_SIGNED_BLOB_SIDECAR);
}

/**
 * Read only the first 4 bytes of Slot, max value is 4,294,967,295 will be reached 1634 years after genesis
 *
 * If the high bytes are not zero, return null
 */
function getSlotFromOffset(data: Uint8Array, offset: number): Slot | null {
  return checkSlotHighBytes(data, offset) ? getSlotFromOffsetTrusted(data, offset) : null;
}

/**
 * Read only the first 4 bytes of Slot, max value is 4,294,967,295 will be reached 1634 years after genesis
 */
function getSlotFromOffsetTrusted(data: Uint8Array, offset: number): Slot {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function checkSlotHighBytes(data: Uint8Array, offset: number): boolean {
  return (data[offset + 4] | data[offset + 5] | data[offset + 6] | data[offset + 7]) === 0;
}
