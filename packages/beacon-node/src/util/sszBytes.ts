import {BitArray, deserializeUint8ArrayBitListFromBytes} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {
  BYTES_PER_FIELD_ELEMENT,
  FIELD_ELEMENTS_PER_BLOB,
  ForkName,
  ForkPostDeneb,
  ForkSeq,
  MAX_COMMITTEES_PER_SLOT,
  isForkPostElectra,
  isForkPostGloas,
} from "@lodestar/params";
import {BLSSignature, CommitteeIndex, RootHex, Slot, ValidatorIndex, ssz} from "@lodestar/types";

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
 * Pre-Gloas DataColumnSidecar:
 * {
 *   index: ColumnIndex [fixed - 8 bytes],
 *   column: DataColumn (offset - 4 bytes),
 *   kzgCommitments: (offset - 4 bytes),
 *   kzgProofs: (offset - 4 bytes),
 *   signedBlockHeader: (offset - 4 bytes) -> slot at variable offset after fixed header
 *   kzgCommitmentsInclusionProof: (offset - 4 bytes),
 * }
 * Post-Gloas DataColumnSidecar:
 * {
 *   index: ColumnIndex [8 bytes],
 *   column: DataColumn (offset - 4 bytes),
 *   kzgProofs: (offset - 4 bytes),
 *   slot: Slot [8 bytes] - at offset 16,
 *   beaconBlockRoot: Root [32 bytes] - at offset 24,
 * }
 */
const SLOT_BYTES_POSITION_IN_SIGNED_DATA_COLUMN_SIDECAR_PRE_GLOAS = 20;
const SLOT_BYTES_POSITION_IN_SIGNED_DATA_COLUMN_SIDECAR_POST_GLOAS = 16;
const BEACON_BLOCK_ROOT_POSITION_IN_GLOAS_DATA_COLUMN_SIDECAR = 24;

export function getSlotFromDataColumnSidecarSerialized(data: Uint8Array, fork: ForkName): Slot | null {
  const offset = isForkPostGloas(fork)
    ? SLOT_BYTES_POSITION_IN_SIGNED_DATA_COLUMN_SIDECAR_POST_GLOAS
    : SLOT_BYTES_POSITION_IN_SIGNED_DATA_COLUMN_SIDECAR_PRE_GLOAS;

  if (data.length < offset + SLOT_SIZE) {
    return null;
  }

  return getSlotFromOffset(data, offset);
}

export function getBeaconBlockRootFromDataColumnSidecarSerialized(data: Uint8Array): RootHex | null {
  if (data.length < BEACON_BLOCK_ROOT_POSITION_IN_GLOAS_DATA_COLUMN_SIDECAR + ROOT_SIZE) {
    return null;
  }

  blockRootBuf.set(
    data.subarray(
      BEACON_BLOCK_ROOT_POSITION_IN_GLOAS_DATA_COLUMN_SIDECAR,
      BEACON_BLOCK_ROOT_POSITION_IN_GLOAS_DATA_COLUMN_SIDECAR + ROOT_SIZE
    )
  );
  return "0x" + blockRootBuf.toString("hex");
}

/**
 * SignedExecutionPayloadEnvelope SSZ Layout:
 * ├─ 4 bytes: message offset (points to byte 100)
 * ├─ 96 bytes: signature
 * └─ ExecutionPayloadEnvelope (starts at byte 100):
 *    ├─ 4 bytes: payload offset
 *    ├─ 4 bytes: executionRequests offset
 *    ├─ 8 bytes: builderIndex        (offset 108-115)
 *    ├─ 32 bytes: beaconBlockRoot    (offset 116-147)
 *    ├─ 8 bytes: slot                (offset 148-155)
 *    └─ 32 bytes: stateRoot          (offset 156-187)
 */
const SIGNED_EXECUTION_PAYLOAD_ENVELOPE_MESSAGE_OFFSET = 4;
const SIGNED_EXECUTION_PAYLOAD_ENVELOPE_SIGNATURE_SIZE = 96;
const EXECUTION_PAYLOAD_ENVELOPE_PAYLOAD_OFFSET = 4;
const EXECUTION_PAYLOAD_ENVELOPE_REQUESTS_OFFSET = 4;
const EXECUTION_PAYLOAD_ENVELOPE_BUILDER_INDEX_SIZE = 8;

const BEACON_BLOCK_ROOT_OFFSET_IN_SIGNED_EXECUTION_PAYLOAD_ENVELOPE =
  SIGNED_EXECUTION_PAYLOAD_ENVELOPE_MESSAGE_OFFSET +
  SIGNED_EXECUTION_PAYLOAD_ENVELOPE_SIGNATURE_SIZE +
  EXECUTION_PAYLOAD_ENVELOPE_PAYLOAD_OFFSET +
  EXECUTION_PAYLOAD_ENVELOPE_REQUESTS_OFFSET +
  EXECUTION_PAYLOAD_ENVELOPE_BUILDER_INDEX_SIZE; // 116

const SLOT_OFFSET_IN_SIGNED_EXECUTION_PAYLOAD_ENVELOPE =
  BEACON_BLOCK_ROOT_OFFSET_IN_SIGNED_EXECUTION_PAYLOAD_ENVELOPE + ROOT_SIZE; // 148

export function getSlotFromExecutionPayloadEnvelopeSerialized(data: Uint8Array): Slot | null {
  if (data.length < SLOT_OFFSET_IN_SIGNED_EXECUTION_PAYLOAD_ENVELOPE + SLOT_SIZE) {
    return null;
  }

  return getSlotFromOffset(data, SLOT_OFFSET_IN_SIGNED_EXECUTION_PAYLOAD_ENVELOPE);
}

export function getBeaconBlockRootFromExecutionPayloadEnvelopeSerialized(data: Uint8Array): RootHex | null {
  if (data.length < BEACON_BLOCK_ROOT_OFFSET_IN_SIGNED_EXECUTION_PAYLOAD_ENVELOPE + ROOT_SIZE) {
    return null;
  }

  blockRootBuf.set(
    data.subarray(
      BEACON_BLOCK_ROOT_OFFSET_IN_SIGNED_EXECUTION_PAYLOAD_ENVELOPE,
      BEACON_BLOCK_ROOT_OFFSET_IN_SIGNED_EXECUTION_PAYLOAD_ENVELOPE + ROOT_SIZE
    )
  );
  return "0x" + blockRootBuf.toString("hex");
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
 * SignedExecutionPayloadEnvelope: {message: ExecutionPayloadEnvelope (variable), signature: BLSSignature (96 bytes)}
 *   Fixed part: 4-byte offset + 96-byte signature = 100 bytes
 *   message data starts at byte 100
 *
 * ExecutionPayloadEnvelope: {
 *   payload: ExecutionPayload (variable) → 4-byte offset
 *   executionRequests: ExecutionRequests (variable) → 4-byte offset
 *   builderIndex: ValidatorIndex (8 bytes)
 *   beaconBlockRoot: Root (32 bytes)
 *   slot: Slot (8 bytes)
 *   stateRoot: Root (32 bytes)
 * }
 *   Fixed part within message: 4 + 4 + 8 + 32 + 8 + 32 = 88 bytes
 *   beaconBlockRoot at message + 16, slot at message + 48
 */
const SIGNED_ENVELOPE_MESSAGE_OFFSET = VARIABLE_FIELD_OFFSET + SIGNATURE_SIZE; // 100
const SIGNED_ENVELOPE_BEACON_BLOCK_ROOT_OFFSET = SIGNED_ENVELOPE_MESSAGE_OFFSET + 4 + 4 + 8; // 116
const SIGNED_ENVELOPE_SLOT_OFFSET = SIGNED_ENVELOPE_BEACON_BLOCK_ROOT_OFFSET + ROOT_SIZE; // 148

export function getSlotFromSignedExecutionPayloadEnvelopeSerialized(data: Uint8Array): Slot | null {
  if (data.length < SIGNED_ENVELOPE_SLOT_OFFSET + SLOT_SIZE) {
    return null;
  }
  return getSlotFromOffset(data, SIGNED_ENVELOPE_SLOT_OFFSET);
}

export function getBlockRootFromSignedExecutionPayloadEnvelopeSerialized(data: Uint8Array): RootHex | null {
  if (data.length < SIGNED_ENVELOPE_BEACON_BLOCK_ROOT_OFFSET + ROOT_SIZE) {
    return null;
  }
  blockRootBuf.set(
    data.subarray(SIGNED_ENVELOPE_BEACON_BLOCK_ROOT_OFFSET, SIGNED_ENVELOPE_BEACON_BLOCK_ROOT_OFFSET + ROOT_SIZE)
  );
  return `0x${blockRootBuf.toString("hex")}`;
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
 * Alias of `getSlotFromOffset` for readability
 */
function getIndexFromOffset(data: Uint8Array, offset: number): (ValidatorIndex | CommitteeIndex) | null {
  return getSlotFromOffset(data, offset);
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

export function getBlobKzgCommitmentsCountFromSignedBeaconBlockSerialized(
  config: ChainForkConfig,
  blockBytes: Uint8Array
): number {
  const slot = getSlotFromSignedBeaconBlockSerialized(blockBytes);
  if (slot === null) throw new Error("Can not parse the slot from block bytes");

  const forkSeq = config.getForkSeq(slot);
  if (forkSeq < ForkSeq.deneb) return 0;
  const commitmentSize = ssz.deneb.KZGCommitment.fixedSize;
  const forkName = config.getForkName(slot);
  const forkSsz = ssz[forkName as ForkPostDeneb];

  const {SignedBeaconBlock, BeaconBlock, BeaconBlockBody} = forkSsz;

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
  let start: number;
  let end: number;

  if (forkSeq >= ForkSeq.gloas) {
    const {SignedExecutionPayloadBid, ExecutionPayloadBid} = forkSsz as typeof ssz.gloas;
    const signedExecutionPayloadBidIndex = Object.keys(BeaconBlockBody.fields).indexOf("signedExecutionPayloadBid");
    if (signedExecutionPayloadBidIndex < 0) return 0;
    const signedExecutionPayloadBidRange = bodyFieldRanges[signedExecutionPayloadBidIndex];
    if (!signedExecutionPayloadBidRange) return 0;

    const signedExecutionPayloadBidFieldRanges = SignedExecutionPayloadBid.getFieldRanges(
      view,
      messageRange.start + bodyRange.start + signedExecutionPayloadBidRange.start,
      messageRange.end + bodyRange.end + signedExecutionPayloadBidRange.end
    );
    const bidMessageIndex = Object.keys(SignedExecutionPayloadBid.fields).indexOf("message");
    if (bidMessageIndex < 0) return 0;
    const bidMessageRange = signedExecutionPayloadBidFieldRanges[bidMessageIndex];
    if (!bidMessageRange) return 0;

    const executionPayloadBidFieldRanges = ExecutionPayloadBid.getFieldRanges(
      view,
      messageRange.start + bodyRange.start + signedExecutionPayloadBidRange.start + bidMessageRange.start,
      messageRange.end + bodyRange.end + signedExecutionPayloadBidRange.end + bidMessageRange.end
    );
    const kzgCommitmentsIndex = Object.keys(ExecutionPayloadBid.fields).indexOf("blobKzgCommitments");
    if (kzgCommitmentsIndex < 0) return 0;
    const kzgCommitmentsRange = executionPayloadBidFieldRanges[kzgCommitmentsIndex];
    if (!kzgCommitmentsRange) return 0;

    end =
      messageRange.end +
      bodyRange.end +
      signedExecutionPayloadBidRange.end +
      bidMessageRange.end +
      kzgCommitmentsRange.end;
    start =
      messageRange.start +
      bodyRange.start +
      signedExecutionPayloadBidRange.start +
      bidMessageRange.start +
      kzgCommitmentsRange.start;
  } else {
    const kzgCommitmentsIndex = Object.keys(BeaconBlockBody.fields).indexOf("blobKzgCommitments");
    if (kzgCommitmentsIndex < 0) return 0;
    const kzgCommitmentsRange = bodyFieldRanges[kzgCommitmentsIndex];
    if (!kzgCommitmentsRange) return 0;
    end = messageRange.end + bodyRange.end + kzgCommitmentsRange.end;
    start = messageRange.start + bodyRange.start + kzgCommitmentsRange.start;
  }

  return Math.round(((end > blockBytes.byteLength ? blockBytes.byteLength : end) - start) / commitmentSize);
}
