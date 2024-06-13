import {BitArray, deserializeUint8ArrayBitListFromBytes} from "@chainsafe/ssz";
import {BLSSignature, RootHex, Slot} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {
  BYTES_PER_FIELD_ELEMENT,
  FIELD_ELEMENTS_PER_BLOB,
  ForkName,
  ForkSeq,
  MAX_COMMITTEES_PER_SLOT,
} from "@lodestar/params";

export type BlockRootHex = RootHex;
export type SeenAttDataKey = AttDataBase64 | AttDataCommitteeBitsBase64;
// pre-electra, AttestationData is used to cache attestations
export type AttDataBase64 = string;
// electra, AttestationData + CommitteeBits are used to cache attestations
export type AttDataCommitteeBitsBase64 = string;

// pre-electra
// class Attestation(Container):
//   aggregation_bits: Bitlist[MAX_VALIDATORS_PER_COMMITTEE] - offset 4
//   data: AttestationData - target data - 128
//   signature: BLSSignature - 96

// electra
// class Attestation(Container):
//   aggregation_bits: BitList[MAX_VALIDATORS_PER_COMMITTEE * MAX_COMMITTEES_PER_SLOT] - offset 4
//   committee_bits: BitVector[MAX_COMMITTEES_PER_SLOT]
//   data: AttestationData - target data - 128
//   signature: BLSSignature - 96
//
// for all forks
// class AttestationData(Container): 128 bytes fixed size
//   slot: Slot                - data 8
//   index: CommitteeIndex     - data 8
//   beacon_block_root: Root   - data 32
//   source: Checkpoint        - data 40
//   target: Checkpoint        - data 40

const VARIABLE_FIELD_OFFSET = 4;
// MAX_COMMITTEES_PER_SLOT is in bit, need to convert to byte
const COMMITTEE_BITS_SIZE = Math.max(Math.ceil(MAX_COMMITTEES_PER_SLOT / 8), 1);
const ROOT_SIZE = 32;
const SLOT_SIZE = 8;
const COMMITTEE_INDEX_SIZE = 8;
const ATTESTATION_DATA_SIZE = 128;
const SIGNATURE_SIZE = 96;

/**
 * Extract slot from attestation serialized bytes.
 * Return null if data is not long enough to extract slot.
 */
export function getSlotFromAttestationSerialized(fork: ForkName, data: Uint8Array): Slot | null {
  const slotStartIndex =
  ForkSeq[fork] >= ForkSeq.electra
    ? VARIABLE_FIELD_OFFSET + COMMITTEE_BITS_SIZE
    : VARIABLE_FIELD_OFFSET;

  if (data.length < slotStartIndex + SLOT_SIZE) {
    return null;
  }

  return getSlotFromOffset(data, slotStartIndex);
}

/**
 * Extract block root from attestation serialized bytes.
 * Return null if data is not long enough to extract block root.
 */
export function getBlockRootFromAttestationSerialized(fork: ForkName, data: Uint8Array): BlockRootHex | null {
  const blockRootStartIndex = ForkSeq[fork] >= ForkSeq.electra ?
    VARIABLE_FIELD_OFFSET + COMMITTEE_BITS_SIZE + SLOT_SIZE + COMMITTEE_INDEX_SIZE :
    VARIABLE_FIELD_OFFSET + SLOT_SIZE + COMMITTEE_INDEX_SIZE;

  if (data.length < blockRootStartIndex + ROOT_SIZE) {
    return null;
  }

  return toHex(data.subarray(blockRootStartIndex, blockRootStartIndex + ROOT_SIZE));
}

/**
 * Extract attestation data key from an attestation Uint8Array in order to index gossip queue and cache later in SeenAttestationDatas
 */
export function getSeenAttDataKey(forkSeq: ForkSeq, data: Uint8Array): SeenAttDataKey | null {
  return forkSeq >= ForkSeq.electra ? getSeenAttDataKeyElectra(data) : getSeenAttDataKeyPhase0(data);
}

/**
 * Extract attestation data + committeeBits base64 from electra attestation serialized bytes.
 * Return null if data is not long enough to extract attestation data.
 */
export function getSeenAttDataKeyElectra(electraAttestationBytes: Uint8Array): AttDataCommitteeBitsBase64 | null {
  const startIndex = VARIABLE_FIELD_OFFSET;
  const seenKeyLength = ATTESTATION_DATA_SIZE + COMMITTEE_BITS_SIZE;

  if (electraAttestationBytes.length < startIndex + seenKeyLength) {
    return null;
  }

  return toBase64(electraAttestationBytes.subarray(startIndex, startIndex + seenKeyLength));
}

/**
 * Extract attestation data base64 from phase0 attestation serialized bytes.
 * Return null if data is not long enough to extract attestation data.
 */
export function getSeenAttDataKeyPhase0(data: Uint8Array): AttDataBase64 | null {
  if (data.length < VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE) {
    return null;
  }

  // base64 is a bit efficient than hex
  return toBase64(data.subarray(VARIABLE_FIELD_OFFSET, VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE));
}

/**
 * Extract aggregation bits from attestation serialized bytes.
 * Return null if data is not long enough to extract aggregation bits.
 */
export function getAggregationBitsFromAttestationSerialized(fork: ForkName, data: Uint8Array): BitArray | null {
  const aggregationBitsStartIndex =
    ForkSeq[fork] >= ForkSeq.electra
      ? VARIABLE_FIELD_OFFSET + COMMITTEE_BITS_SIZE + ATTESTATION_DATA_SIZE + SIGNATURE_SIZE
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
export function getSignatureFromAttestationSerialized(fork: ForkName, data: Uint8Array): BLSSignature | null {
  const signatureStartIndex =
    ForkSeq[fork] >= ForkSeq.electra
      ? VARIABLE_FIELD_OFFSET + COMMITTEE_BITS_SIZE + ATTESTATION_DATA_SIZE
      : VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE;

  if (data.length < signatureStartIndex + SIGNATURE_SIZE) {
    return null;
  }

  return data.subarray(signatureStartIndex, signatureStartIndex + SIGNATURE_SIZE);
}

/**
 * Extract committee bits from Electra attestation serialized bytes.
 * Return null if data is not long enough to extract committee bits.
 */
export function getCommitteeBitsFromAttestationSerialized(data: Uint8Array): BitArray | null {
  const committeeBitsStartIndex = VARIABLE_FIELD_OFFSET;

  if (data.length < committeeBitsStartIndex + COMMITTEE_BITS_SIZE) {
    return null;
  }

  const uint8Array = data.subarray(committeeBitsStartIndex, committeeBitsStartIndex + COMMITTEE_BITS_SIZE);

  return new BitArray(uint8Array, MAX_COMMITTEES_PER_SLOT);
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

  return toHex(
    data.subarray(
      SIGNED_AGGREGATE_AND_PROOF_BLOCK_ROOT_OFFSET,
      SIGNED_AGGREGATE_AND_PROOF_BLOCK_ROOT_OFFSET + ROOT_SIZE
    )
  );
}

/**
 * Extract attestation data key from SignedAggregateAndProof Uint8Array to use cached data from SeenAttestationDatas
 */
export function getSeenAttDataKeyFromSignedAggregateAndProof(
  forkSeq: ForkSeq,
  data: Uint8Array
): SeenAttDataKey | null {
  return forkSeq >= ForkSeq.electra
    ? getSeenAttDataKeyFromSignedAggregateAndProofElectra(data)
    : getSeenAttDataKeyFromSignedAggregateAndProofPhase0(data);
}

/**
 * Extract AttestationData + CommitteeBits from SignedAggregateAndProof for electra
 * Return null if data is not long enough
 */
export function getSeenAttDataKeyFromSignedAggregateAndProofElectra(data: Uint8Array): SeenAttDataKey | null {
  const startIndex = SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET;
  const endIndex = startIndex + ATTESTATION_DATA_SIZE + COMMITTEE_BITS_SIZE;

  if (data.length < endIndex) {
    return null;
  }

  // base64 is a bit efficient than hex
  return toBase64(data.subarray(startIndex, endIndex));
}

/**
 * Extract attestation data base64 from signed aggregate and proof serialized bytes.
 * Return null if data is not long enough to extract attestation data.
 */
export function getSeenAttDataKeyFromSignedAggregateAndProofPhase0(data: Uint8Array): AttDataBase64 | null {
  if (data.length < SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET + ATTESTATION_DATA_SIZE) {
    return null;
  }

  // base64 is a bit efficient than hex
  return toBase64(
    data.subarray(
      SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET,
      SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET + ATTESTATION_DATA_SIZE
    )
  );
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

function getSlotFromOffset(data: Uint8Array, offset: number): Slot {
  // TODO: Optimize
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Read only the first 4 bytes of Slot, max value is 4,294,967,295 will be reached 1634 years after genesis
  return dv.getUint32(offset, true);
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
}
