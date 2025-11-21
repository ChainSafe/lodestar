import {BitArray, deserializeUint8ArrayBitListFromBytes} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {
  BYTES_PER_FIELD_ELEMENT,
  FIELD_ELEMENTS_PER_BLOB,
  ForkName,
  ForkPostDeneb,
  ForkSeq,
  KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH,
  MAX_BLOB_COMMITMENTS_PER_BLOCK,
  MAX_COMMITTEES_PER_SLOT,
  isForkPostElectra,
} from "@lodestar/params";
import {BLSSignature, CommitteeIndex, RootHex, Slot, ValidatorIndex, phase0, ssz} from "@lodestar/types";
import {DataColumnSidecar} from "@lodestar/types/fulu";

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
// electra
// class SingleAttestation(Container):
//   committeeIndex: CommitteeIndex - data 8
//   attesterIndex: ValidatorIndex - data 8
//   data: AttestationData - data 128
//   signature: BLSSignature - data 96
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
export const ROOT_SIZE = 32;
const SLOT_SIZE = 8;
const COMMITTEE_INDEX_SIZE = 8;
const ATTESTATION_DATA_SIZE = 128;
// MAX_COMMITTEES_PER_SLOT is in bit, need to convert to byte
const COMMITTEE_BITS_SIZE = Math.max(Math.ceil(MAX_COMMITTEES_PER_SLOT / 8), 1);
const SIGNATURE_SIZE = 96;
const SINGLE_ATTESTATION_ATTDATA_OFFSET = 8 + 8;
const SINGLE_ATTESTATION_SLOT_OFFSET = SINGLE_ATTESTATION_ATTDATA_OFFSET;
const SINGLE_ATTESTATION_COMMITTEE_INDEX_OFFSET = 0;
const SINGLE_ATTESTATION_ATTESTER_INDEX_OFFSET = 8;
const SINGLE_ATTESTATION_BEACON_BLOCK_ROOT_OFFSET = SINGLE_ATTESTATION_ATTDATA_OFFSET + 8 + 8;
const SINGLE_ATTESTATION_SIGNATURE_OFFSET = SINGLE_ATTESTATION_ATTDATA_OFFSET + ATTESTATION_DATA_SIZE;
const SINGLE_ATTESTATION_SIZE = SINGLE_ATTESTATION_SIGNATURE_OFFSET + SIGNATURE_SIZE;

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
 * Extract AttDataBase64 from `beacon_attestation` gossip message serialized bytes.
 * This is used for GossipQueue.
 */
export function getBeaconAttestationGossipIndex(fork: ForkName, data: Uint8Array): AttDataBase64 | null {
  return ForkSeq[fork] >= ForkSeq.electra
    ? getAttDataFromSingleAttestationSerialized(data)
    : getAttDataFromAttestationSerialized(data);
}

/**
 * Extract slot from `beacon_attestation` gossip message serialized bytes.
 */
export function getSlotFromBeaconAttestationSerialized(fork: ForkName, data: Uint8Array): Slot | null {
  return ForkSeq[fork] >= ForkSeq.electra
    ? getSlotFromSingleAttestationSerialized(data)
    : getSlotFromAttestationSerialized(data);
}

/**
 * Extract block root from `beacon_attestation` gossip message serialized bytes.
 */
export function getBlockRootFromBeaconAttestationSerialized(fork: ForkName, data: Uint8Array): BlockRootHex | null {
  return ForkSeq[fork] >= ForkSeq.electra
    ? getBlockRootFromSingleAttestationSerialized(data)
    : getBlockRootFromAttestationSerialized(data);
}

/**
 * Extract aggregation bits from attestation serialized bytes.
 * Return null if data is not long enough to extract aggregation bits.
 * Pre-electra attestation only
 */
export function getAggregationBitsFromAttestationSerialized(data: Uint8Array): BitArray | null {
  const aggregationBitsStartIndex = VARIABLE_FIELD_OFFSET + ATTESTATION_DATA_SIZE + SIGNATURE_SIZE;

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
 * Extract slot from SingleAttestation serialized bytes.
 * Return null if data is not long enough to extract slot.
 */
export function getSlotFromSingleAttestationSerialized(data: Uint8Array): Slot | null {
  if (data.length !== SINGLE_ATTESTATION_SIZE) {
    return null;
  }

  return getSlotFromOffset(data, SINGLE_ATTESTATION_SLOT_OFFSET);
}

/**
 * Extract committee index from SingleAttestation serialized bytes.
 * Return null if data is not long enough to extract slot.
 */
export function getCommitteeIndexFromSingleAttestationSerialized(
  fork: ForkName,
  data: Uint8Array
): CommitteeIndex | null {
  if (isForkPostElectra(fork)) {
    if (data.length !== SINGLE_ATTESTATION_SIZE) {
      return null;
    }

    return getIndexFromOffset(data, SINGLE_ATTESTATION_COMMITTEE_INDEX_OFFSET);
  }

  if (data.length < VARIABLE_FIELD_OFFSET + SLOT_SIZE + COMMITTEE_INDEX_SIZE) {
    return null;
  }

  return getIndexFromOffset(data, VARIABLE_FIELD_OFFSET + SLOT_SIZE);
}

/**
 * Extract attester index from SingleAttestation serialized bytes.
 * Return null if data is not long enough to extract index.
 */
export function getAttesterIndexFromSingleAttestationSerialized(data: Uint8Array): ValidatorIndex | null {
  if (data.length !== SINGLE_ATTESTATION_SIZE) {
    return null;
  }

  return getIndexFromOffset(data, SINGLE_ATTESTATION_ATTESTER_INDEX_OFFSET);
}

/**
 * Extract block root from SingleAttestation serialized bytes.
 * Return null if data is not long enough to extract block root.
 */
export function getBlockRootFromSingleAttestationSerialized(data: Uint8Array): BlockRootHex | null {
  if (data.length !== SINGLE_ATTESTATION_SIZE) {
    return null;
  }

  blockRootBuf.set(
    data.subarray(SINGLE_ATTESTATION_BEACON_BLOCK_ROOT_OFFSET, SINGLE_ATTESTATION_BEACON_BLOCK_ROOT_OFFSET + ROOT_SIZE)
  );
  return `0x${blockRootBuf.toString("hex")}`;
}

/**
 * Extract attestation data base64 from SingleAttestation serialized bytes.
 * Return null if data is not long enough to extract attestation data.
 */
export function getAttDataFromSingleAttestationSerialized(data: Uint8Array): AttDataBase64 | null {
  if (data.length !== SINGLE_ATTESTATION_SIZE) {
    return null;
  }

  // base64 is a bit efficient than hex
  attDataBuf.set(
    data.subarray(SINGLE_ATTESTATION_ATTDATA_OFFSET, SINGLE_ATTESTATION_ATTDATA_OFFSET + ATTESTATION_DATA_SIZE)
  );
  return attDataBuf.toString("base64");
}

/**
 * Extract signature from SingleAttestation serialized bytes.
 * Return null if data is not long enough to extract signature.
 */
export function getSignatureFromSingleAttestationSerialized(data: Uint8Array): BLSSignature | null {
  if (data.length !== SINGLE_ATTESTATION_SIZE) {
    return null;
  }

  return data.subarray(SINGLE_ATTESTATION_SIGNATURE_OFFSET, SINGLE_ATTESTATION_SIGNATURE_OFFSET + SIGNATURE_SIZE);
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
 * {
    index: ColumnIndex [ fixed - 8 bytes],
    column: DataColumn BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_CELL * <some non fixed length>,
    kzgCommitments: denebSsz.BlobKzgCommitments,
    kzgProofs: denebSsz.KZGProofs,
    signedBlockHeader: phase0Ssz.SignedBeaconBlockHeader,
    kzgCommitmentsInclusionProof: KzgCommitmentsInclusionProof,
  }
 */

const SLOT_BYTES_POSITION_IN_SIGNED_DATA_COLUMN_SIDECAR = 20;
export function getSlotFromDataColumnSidecarSerialized(data: Uint8Array): Slot | null {
  if (data.length < SLOT_BYTES_POSITION_IN_SIGNED_DATA_COLUMN_SIDECAR + SLOT_SIZE) {
    return null;
  }

  return getSlotFromOffset(data, SLOT_BYTES_POSITION_IN_SIGNED_DATA_COLUMN_SIDECAR);
}

/**
 * Deserialize DataColumnSidecar using the backed array itself instead of copying (which the ssz lib does)
 * This method is unsafe if the input data is shared and modified later
 */
export function deserializeDataColumnSidecarUnsafe(data: Uint8Array): DataColumnSidecar | null {
  let offset = 0;
  const index = getIndexFromOffset(data, 0);
  if (index === null) return null;
  // index field is 8 bytes
  offset += ssz.ColumnIndex.fixedSize;
  const columnStartOffset = getUint32(data, offset);
  // column field is not fixed size
  offset += VARIABLE_FIELD_OFFSET;
  const kzgCommitmentsStartOffset = getUint32(data, offset);
  // kzgCommitments field is not fixed size
  offset += VARIABLE_FIELD_OFFSET;
  const kzgProofsStartOffset = getUint32(data, offset);
  // kzgProofs field is not fixed size
  offset += VARIABLE_FIELD_OFFSET;
  const signedBlockHeader = deserializeSignedBlockHeaderUnsafe(
    Uint8Array.prototype.subarray.call(data, offset, offset + SIGNED_BLOCK_HEADER_SIZE)
  );
  if (signedBlockHeader === null) return null;
  // signedBlockHeader field is fixed size 208 bytes
  offset += SIGNED_BLOCK_HEADER_SIZE;
  const inclusionProofSize = ssz.fulu.KzgCommitmentsInclusionProof.fixedSize;
  // this should not happen, just want to make the compiler happy
  if (inclusionProofSize === null) return null;
  const kzgCommitmentsInclusionProofData = Uint8Array.prototype.subarray.call(
    data,
    offset,
    offset + inclusionProofSize
  );
  const kzgCommitmentsInclusionProof = new Array<Uint8Array>(KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH);
  for (let i = 0; i < KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH; i++) {
    kzgCommitmentsInclusionProof[i] = Uint8Array.prototype.subarray.call(
      kzgCommitmentsInclusionProofData,
      i * BYTES_PER_FIELD_ELEMENT,
      (i + 1) * BYTES_PER_FIELD_ELEMENT
    );
  }

  // deserialize for dynamic fields
  const columnData = Uint8Array.prototype.subarray.call(data, columnStartOffset, kzgCommitmentsStartOffset);
  if (columnData.length % ssz.fulu.Cell.fixedSize !== 0) return null;
  const numCells = Math.floor(columnData.length / ssz.fulu.Cell.fixedSize);
  const column = new Array<Uint8Array>(numCells);
  for (let i = 0; i < numCells; i++) {
    column[i] = Uint8Array.prototype.subarray.call(
      columnData,
      i * ssz.fulu.Cell.fixedSize,
      (i + 1) * ssz.fulu.Cell.fixedSize
    );
  }

  const kzgCommitmentsData = Uint8Array.prototype.subarray.call(data, kzgCommitmentsStartOffset, kzgProofsStartOffset);
  if (kzgCommitmentsData.length % ssz.deneb.KZGCommitment.fixedSize !== 0) return null;
  const numKzgCommitments = Math.floor(kzgCommitmentsData.length / ssz.deneb.KZGCommitment.fixedSize);
  const kzgCommitments = new Array<Uint8Array>(numKzgCommitments);
  for (let i = 0; i < numKzgCommitments; i++) {
    kzgCommitments[i] = Uint8Array.prototype.subarray.call(
      kzgCommitmentsData,
      i * ssz.deneb.KZGCommitment.fixedSize,
      (i + 1) * ssz.deneb.KZGCommitment.fixedSize
    );
  }

  const kzgProofsData = Uint8Array.prototype.subarray.call(
    data,
    kzgProofsStartOffset,
    // this is the last dynamic field
    data.length
  );
  if (kzgProofsData.length % ssz.deneb.KZGProof.fixedSize !== 0) return null;
  const numKzgProofs = Math.floor(kzgProofsData.length / ssz.deneb.KZGProof.fixedSize);
  const kzgProofs = new Array<Uint8Array>(numKzgProofs);
  for (let i = 0; i < numKzgProofs; i++) {
    kzgProofs[i] = Uint8Array.prototype.subarray.call(
      kzgProofsData,
      i * ssz.deneb.KZGProof.fixedSize,
      (i + 1) * ssz.deneb.KZGProof.fixedSize
    );
  }

  return {
    index,
    column,
    kzgCommitments,
    kzgProofs,
    signedBlockHeader,
    kzgCommitmentsInclusionProof,
  };
}

/** SignedBeaconBlockHeader is 208 bytes fixed size
 *    message: BeaconBlockHeader - 112 bytes
 *      slot: Slot - 8 bytes
 *      proposer_index: ValidatorIndex - 8 bytes
 *      parent_root: Root - 32 bytes
 *      state_root: Root - 32 bytes
 *      body_root: Root - 32 bytes
 *    signature: BLSSignature - 96 bytes
 */
const SIGNED_BLOCK_HEADER_SIZE = 208;

/**
 * Deserialize SignedBeaconBlockHeader using the backed array itself instead of copying (which the ssz lib does)
 * This method is unsafe if the input data is shared and modified later
 */
export function deserializeSignedBlockHeaderUnsafe(data: Uint8Array): phase0.SignedBeaconBlockHeader | null {
  if (data.length !== SIGNED_BLOCK_HEADER_SIZE) return null;

  let offset = 0;
  const slot = getSlotFromOffset(data, offset);
  if (slot === null) return null;
  // slot is 8 bytes
  offset += ssz.Slot.fixedSize;
  const proposerIndex = getIndexFromOffset(data, offset);
  if (proposerIndex === null) return null;
  // proposerIndex is 8 bytes
  offset += 8;
  const parentRoot = Uint8Array.prototype.subarray.call(data, offset, offset + ssz.Root.fixedSize);
  // parentRoot is 32 bytes
  offset += ssz.Root.fixedSize;
  const stateRoot = Uint8Array.prototype.subarray.call(data, offset, offset + ssz.Root.fixedSize);
  // stateRoot is 32 bytes
  offset += ssz.Root.fixedSize;
  const bodyRoot = Uint8Array.prototype.subarray.call(data, offset, offset + ssz.Root.fixedSize);
  // bodyRoot is 32 bytes
  offset += ssz.Root.fixedSize;
  // signature is 96 bytes
  const signature = Uint8Array.prototype.subarray.call(data, offset, offset + ssz.BLSSignature.fixedSize);
  return {
    message: {
      slot,
      proposerIndex,
      parentRoot,
      stateRoot,
      bodyRoot,
    },
    signature,
  };
}

/**
 * BeaconState of all forks (up until Electra, check with new forks)
 * class BeaconState(Container):
 *   genesis_time: uint64                    - 8 bytes
 *   genesis_validators_root: Root           - 32 bytes
 *   slot: Slot                              - 8 bytes
 *   fork: Fork                              - 16 bytes
 *   latest_block_header: BeaconBlockHeader  - fixed size
 *     slot: Slot                            - 8 bytes
 *
 */

const BLOCK_HEADER_SLOT_BYTES_POSITION_IN_BEACON_STATE = 8 + 32 + 8 + 16;
export function getLastProcessedSlotFromBeaconStateSerialized(data: Uint8Array): Slot | null {
  if (data.length < BLOCK_HEADER_SLOT_BYTES_POSITION_IN_BEACON_STATE + SLOT_SIZE) {
    return null;
  }

  return getSlotFromOffset(data, BLOCK_HEADER_SLOT_BYTES_POSITION_IN_BEACON_STATE);
}

const SLOT_BYTES_POSITION_IN_BEACON_STATE = 8 + 32;
export function getSlotFromBeaconStateSerialized(data: Uint8Array): Slot | null {
  if (data.length < SLOT_BYTES_POSITION_IN_BEACON_STATE) {
    return null;
  }

  return getSlotFromOffset(data, SLOT_BYTES_POSITION_IN_BEACON_STATE);
}

/**
 * Read only the first 4 bytes of Slot, max value is 4,294,967,295 will be reached 1634 years after genesis
 *
 * If the high bytes are not zero, return null
 */
function getSlotFromOffset(data: Uint8Array, offset: number): Slot | null {
  return checkSlotHighBytes(data, offset) ? getUint32(data, offset) : null;
}

/**
 * Alias of `getSlotFromOffset` for readability
 */
function getIndexFromOffset(data: Uint8Array, offset: number): (ValidatorIndex | CommitteeIndex) | null {
  return getSlotFromOffset(data, offset);
}

/**
 * Read only the first 4 bytes of Slot, max value is 4,294,967,295 will be reached 1634 years after genesis
 */
function getUint32(data: Uint8Array, offset: number): Slot {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function checkSlotHighBytes(data: Uint8Array, offset: number): boolean {
  return (data[offset + 4] | data[offset + 5] | data[offset + 6] | data[offset + 7]) === 0;
}

export function getBlobKzgCommitmentsCountFromSignedBeaconBlockSerialized(
  config: ChainForkConfig,
  blockBytes: Uint8Array
): number {
  const slot = getSlotFromSignedBeaconBlockSerialized(blockBytes);
  if (!slot) throw new Error("Can not parse the slot from block bytes");

  if (config.getForkSeq(slot) < ForkSeq.deneb) return 0;

  const {SignedBeaconBlock, BeaconBlock, BeaconBlockBody, KZGCommitment} =
    ssz[config.getForkName(slot) as ForkPostDeneb];

  const view = new DataView(blockBytes.buffer, blockBytes.byteOffset, blockBytes.byteLength);
  const singedBlockFieldRanges = SignedBeaconBlock.getFieldRanges(view, 0, blockBytes.length);
  const messageIndex = Object.keys(SignedBeaconBlock.fields).indexOf("message");
  const messageRange = singedBlockFieldRanges[messageIndex];

  const blockFieldRanges = BeaconBlock.getFieldRanges(view, messageRange.start, messageRange.end);
  const bodyIndex = Object.keys(BeaconBlock.fields).indexOf("body");
  const bodyRange = blockFieldRanges[bodyIndex];

  const bodyFieldRanges = BeaconBlockBody.getFieldRanges(
    view,
    messageRange.start + bodyRange.start,
    messageRange.end + bodyRange.end
  );
  const kzgCommitmentsIndex = Object.keys(BeaconBlockBody.fields).indexOf("blobKzgCommitments");
  const kzgCommitmentsRange = bodyFieldRanges[kzgCommitmentsIndex];
  const commitmentSize = KZGCommitment.fixedSize;

  const end = messageRange.end + bodyRange.end + kzgCommitmentsRange.end;
  const start = messageRange.start + bodyRange.start + kzgCommitmentsRange.start;

  return Math.round(((end > blockBytes.byteLength ? blockBytes.byteLength : end) - start) / commitmentSize);
}
