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
 * Extract index from SingleAttestation serialized bytes.
 * Post-gloas, `index` field is repurposed:
 *   - 0 — payload was not available (or attestation is same-slot, where availability is not yet known)
 *   - 1 - payload was available
 * Return null if data is not long enough to extract slot.
 */
export function getIndexFromSingleAttestationSerialized(fork: ForkName, data: Uint8Array): CommitteeIndex | null {
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
const SIGNED_AGGREGATE_AND_PROOF_COMMITTEE_INDEX_OFFSET = SIGNED_AGGREGATE_AND_PROOF_SLOT_OFFSET + SLOT_SIZE;
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
 * Extract index from signed aggregate and proof serialized bytes.
 * Return null if data is not long enough to extract index.
 * This works for both phase0 + electra (index is in attestation data at the same offset).
 */
export function getIndexFromSignedAggregateAndProofSerialized(data: Uint8Array): CommitteeIndex | null {
  if (data.length < SIGNED_AGGREGATE_AND_PROOF_COMMITTEE_INDEX_OFFSET + COMMITTEE_INDEX_SIZE) {
    return null;
  }

  return getIndexFromOffset(data, SIGNED_AGGREGATE_AND_PROOF_COMMITTEE_INDEX_OFFSET);
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
// proposer_index is ValidatorIndex = uint64 = 8 bytes
const PARENT_ROOT_BYTES_POSITION_IN_SIGNED_BEACON_BLOCK = VARIABLE_FIELD_OFFSET + SIGNATURE_SIZE + SLOT_SIZE + 8;

export function getSlotFromSignedBeaconBlockSerialized(data: Uint8Array): Slot | null {
  if (data.length < SLOT_BYTES_POSITION_IN_SIGNED_BEACON_BLOCK + SLOT_SIZE) {
    return null;
  }

  return getSlotFromOffset(data, SLOT_BYTES_POSITION_IN_SIGNED_BEACON_BLOCK);
}

export function getParentRootFromSignedBeaconBlockSerialized(data: Uint8Array): RootHex | null {
  if (data.length < PARENT_ROOT_BYTES_POSITION_IN_SIGNED_BEACON_BLOCK + ROOT_SIZE) {
    return null;
  }
  blockRootBuf.set(
    data.subarray(
      PARENT_ROOT_BYTES_POSITION_IN_SIGNED_BEACON_BLOCK,
      PARENT_ROOT_BYTES_POSITION_IN_SIGNED_BEACON_BLOCK + ROOT_SIZE
    )
  );
  return `0x${blockRootBuf.toString("hex")}`;
}

/**
 * Extract parentBlockHash from a GLOAS SignedBeaconBlock by navigating the SSZ offset pointer
 * to the embedded SignedExecutionPayloadBid.
 *
 * Layout (bytes from start of SignedBeaconBlock):
 *   [0..4)    message offset
 *   [4..100)  signature (96 B)
 *   [100..184) BeaconBlock fixed section: slot(8)+proposer_index(8)+parent_root(32)+state_root(32)+body_offset(4)
 *   [184..)   BeaconBlockBody
 *
 * BeaconBlockBody (GLOAS) fixed section before signedExecutionPayloadBid offset pointer:
 *   randaoReveal(96) + eth1Data(72) + graffiti(32)
 *   + proposerSlashings(4) + attesterSlashings(4) + attestations(4) + deposits(4) + voluntaryExits(4)
 *   + syncAggregate(160) + blsToExecutionChanges(4) = 384 bytes
 *
 * The 4-byte pointer at byte 568 (= 184+384) gives the offset of SignedExecutionPayloadBid
 * within BeaconBlockBody. parentBlockHash is at that bid's byte 100 (after offset+sig).
 */
// BeaconBlock body starts after: msg_offset(4) + sig(96) + slot(8) + proposer_index(8) + parent_root(32) + state_root(32) + body_offset_ptr(4)
const GLOAS_BODY_START_IN_SIGNED_BEACON_BLOCK =
  VARIABLE_FIELD_OFFSET + SIGNATURE_SIZE + SLOT_SIZE + 8 + ROOT_SIZE + ROOT_SIZE + VARIABLE_FIELD_OFFSET; // = 184
const GLOAS_SIGNED_BID_OFFSET_POINTER_IN_BODY = 96 + 72 + 32 + 4 + 4 + 4 + 4 + 4 + 160 + 4; // = 384
const GLOAS_SIGNED_BID_OFFSET_POINTER_IN_SIGNED_BEACON_BLOCK =
  GLOAS_BODY_START_IN_SIGNED_BEACON_BLOCK + GLOAS_SIGNED_BID_OFFSET_POINTER_IN_BODY; // = 568
// Within SignedExecutionPayloadBid, parentBlockHash is at byte 100 (msg_offset:4 + sig:96)
const PARENT_BLOCK_HASH_OFFSET_IN_SIGNED_BID = VARIABLE_FIELD_OFFSET + SIGNATURE_SIZE; // = 100

// CAUTION: update offsets if BeaconBlockBody fixed fields change after Gloas
export function getParentBlockHashFromGloasSignedBeaconBlockSerialized(data: Uint8Array): RootHex | null {
  if (data.length < GLOAS_SIGNED_BID_OFFSET_POINTER_IN_SIGNED_BEACON_BLOCK + VARIABLE_FIELD_OFFSET) {
    return null;
  }
  const bidOffset =
    data[GLOAS_SIGNED_BID_OFFSET_POINTER_IN_SIGNED_BEACON_BLOCK] |
    (data[GLOAS_SIGNED_BID_OFFSET_POINTER_IN_SIGNED_BEACON_BLOCK + 1] << 8) |
    (data[GLOAS_SIGNED_BID_OFFSET_POINTER_IN_SIGNED_BEACON_BLOCK + 2] << 16) |
    (data[GLOAS_SIGNED_BID_OFFSET_POINTER_IN_SIGNED_BEACON_BLOCK + 3] << 24);

  const parentBlockHashStart =
    GLOAS_BODY_START_IN_SIGNED_BEACON_BLOCK + bidOffset + PARENT_BLOCK_HASH_OFFSET_IN_SIGNED_BID;

  if (data.length < parentBlockHashStart + ROOT_SIZE) {
    return null;
  }

  blockRootBuf.set(data.subarray(parentBlockHashStart, parentBlockHashStart + ROOT_SIZE));
  return `0x${blockRootBuf.toString("hex")}`;
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
 * PayloadAttestationMessage: {
 *   validatorIndex: ValidatorIndex (8 bytes)
 *   data: PayloadAttestationData {
 *     beaconBlockRoot: Root (32 bytes)  ← offset 8
 *     slot: Slot (8 bytes)              ← offset 40
 *     payloadPresent: Boolean (1 byte)
 *     blobDataAvailable: Boolean (1 byte)
 *   }
 *   signature: BLSSignature (96 bytes)
 * }
 * Fully fixed-size container, no offset table.
 */
const PAYLOAD_ATTESTATION_MESSAGE_BEACON_BLOCK_ROOT_OFFSET = 8;
const PAYLOAD_ATTESTATION_MESSAGE_SLOT_OFFSET = 8 + ROOT_SIZE; // 40
const PAYLOAD_ATTESTATION_MESSAGE_PAYLOAD_PRESENT_OFFSET = PAYLOAD_ATTESTATION_MESSAGE_SLOT_OFFSET + SLOT_SIZE; // 48

export function getSlotFromPayloadAttestationMessageSerialized(data: Uint8Array): Slot | null {
  if (data.length < PAYLOAD_ATTESTATION_MESSAGE_SLOT_OFFSET + SLOT_SIZE) {
    return null;
  }
  return getSlotFromOffset(data, PAYLOAD_ATTESTATION_MESSAGE_SLOT_OFFSET);
}

export function getPayloadPresentFromPayloadAttestationMessageSerialized(data: Uint8Array): boolean | null {
  if (data.length < PAYLOAD_ATTESTATION_MESSAGE_PAYLOAD_PRESENT_OFFSET + 1) {
    return null;
  }
  return data[PAYLOAD_ATTESTATION_MESSAGE_PAYLOAD_PRESENT_OFFSET] !== 0;
}

export function getBlockRootFromPayloadAttestationMessageSerialized(data: Uint8Array): RootHex | null {
  if (data.length < PAYLOAD_ATTESTATION_MESSAGE_BEACON_BLOCK_ROOT_OFFSET + ROOT_SIZE) {
    return null;
  }
  blockRootBuf.set(
    data.subarray(
      PAYLOAD_ATTESTATION_MESSAGE_BEACON_BLOCK_ROOT_OFFSET,
      PAYLOAD_ATTESTATION_MESSAGE_BEACON_BLOCK_ROOT_OFFSET + ROOT_SIZE
    )
  );
  return `0x${blockRootBuf.toString("hex")}`;
}

/**
 * SignedExecutionPayloadBid: {message: ExecutionPayloadBid (variable), signature: BLSSignature (96 bytes)}
 *   Fixed part: 4-byte offset + 96-byte signature = 100 bytes
 *   message data starts at byte 100
 *
 * ExecutionPayloadBid fixed fields (in order):
 *   parentBlockHash: Bytes32      (32 bytes)
 *   parentBlockRoot: Root         (32 bytes)
 *   blockHash: Bytes32            (32 bytes)
 *   prevRandao: Bytes32           (32 bytes)
 *   feeRecipient: ExecutionAddress(20 bytes)
 *   gasLimit: UintBn64            (8 bytes)
 *   builderIndex: BuilderIndex    (8 bytes)
 *   slot: Slot                    (8 bytes)  ← absolute offset 264
 */
const SIGNED_EXECUTION_PAYLOAD_BID_PARENT_BLOCK_HASH_OFFSET = VARIABLE_FIELD_OFFSET + SIGNATURE_SIZE; // 100
const SIGNED_EXECUTION_PAYLOAD_BID_PARENT_BLOCK_ROOT_OFFSET =
  SIGNED_EXECUTION_PAYLOAD_BID_PARENT_BLOCK_HASH_OFFSET + ROOT_SIZE; // 132
const SIGNED_EXECUTION_PAYLOAD_BID_SLOT_OFFSET =
  VARIABLE_FIELD_OFFSET + SIGNATURE_SIZE + 32 + 32 + 32 + 32 + 20 + 8 + 8; // 264

export function getSlotFromSignedExecutionPayloadBidSerialized(data: Uint8Array): Slot | null {
  if (data.length < SIGNED_EXECUTION_PAYLOAD_BID_SLOT_OFFSET + SLOT_SIZE) {
    return null;
  }
  return getSlotFromOffset(data, SIGNED_EXECUTION_PAYLOAD_BID_SLOT_OFFSET);
}

export function getParentBlockHashFromSignedExecutionPayloadBidSerialized(data: Uint8Array): RootHex | null {
  if (data.length < SIGNED_EXECUTION_PAYLOAD_BID_PARENT_BLOCK_HASH_OFFSET + ROOT_SIZE) {
    return null;
  }
  blockRootBuf.set(
    data.subarray(
      SIGNED_EXECUTION_PAYLOAD_BID_PARENT_BLOCK_HASH_OFFSET,
      SIGNED_EXECUTION_PAYLOAD_BID_PARENT_BLOCK_HASH_OFFSET + ROOT_SIZE
    )
  );
  return `0x${blockRootBuf.toString("hex")}`;
}

export function getParentBlockRootFromSignedExecutionPayloadBidSerialized(data: Uint8Array): RootHex | null {
  if (data.length < SIGNED_EXECUTION_PAYLOAD_BID_PARENT_BLOCK_ROOT_OFFSET + ROOT_SIZE) {
    return null;
  }
  blockRootBuf.set(
    data.subarray(
      SIGNED_EXECUTION_PAYLOAD_BID_PARENT_BLOCK_ROOT_OFFSET,
      SIGNED_EXECUTION_PAYLOAD_BID_PARENT_BLOCK_ROOT_OFFSET + ROOT_SIZE
    )
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

  if (config.getForkSeq(slot) < ForkSeq.deneb) return 0;
  const forkName = config.getForkName(slot);

  if (isForkPostGloas(forkName)) {
    // Gloas stores commitments under signedExecutionPayloadBid.message.blobKzgCommitments.
    // Navigate the offset chain: SignedBeaconBlock → message → body → signedExecutionPayloadBid → message → blobKzgCommitments
    const {SignedBeaconBlock: GloasSignedBlock, BeaconBlock: GloasBlock, BeaconBlockBody: GloasBody} = ssz[forkName];
    const {SignedExecutionPayloadBid, ExecutionPayloadBid} = ssz[forkName];
    const commitmentSize = ssz.deneb.KZGCommitment.fixedSize;

    const view = new DataView(blockBytes.buffer, blockBytes.byteOffset, blockBytes.byteLength);

    const signedBlockRanges = GloasSignedBlock.getFieldRanges(view, 0, blockBytes.length);
    const messageIdx = Object.keys(GloasSignedBlock.fields).indexOf("message");
    const messageRange = signedBlockRanges[messageIdx];

    const blockRanges = GloasBlock.getFieldRanges(view, messageRange.start, messageRange.end);
    const bodyIdx = Object.keys(GloasBlock.fields).indexOf("body");
    const bodyRange = blockRanges[bodyIdx];
    const bodyStart = messageRange.start + bodyRange.start;
    const bodyEnd = messageRange.start + bodyRange.end;

    const bodyRanges = GloasBody.getFieldRanges(view, bodyStart, bodyEnd);
    const bidIdx = Object.keys(GloasBody.fields).indexOf("signedExecutionPayloadBid");
    const bidRange = bodyRanges[bidIdx];
    const bidStart = bodyStart + bidRange.start;
    const bidEnd = bodyStart + bidRange.end;

    const bidRanges = SignedExecutionPayloadBid.getFieldRanges(view, bidStart, bidEnd);
    const bidMsgIdx = Object.keys(SignedExecutionPayloadBid.fields).indexOf("message");
    const bidMsgRange = bidRanges[bidMsgIdx];
    const bidMsgStart = bidStart + bidMsgRange.start;
    const bidMsgEnd = bidStart + bidMsgRange.end;

    const execBidRanges = ExecutionPayloadBid.getFieldRanges(view, bidMsgStart, bidMsgEnd);
    const commitmentsIdx = Object.keys(ExecutionPayloadBid.fields).indexOf("blobKzgCommitments");
    const commitmentsRange = execBidRanges[commitmentsIdx];

    const start = bidMsgStart + commitmentsRange.start;
    const end = bidMsgStart + commitmentsRange.end;
    return Math.round(((end > blockBytes.byteLength ? blockBytes.byteLength : end) - start) / commitmentSize);
  }

  const {SignedBeaconBlock, BeaconBlock, BeaconBlockBody, KZGCommitment} = ssz[forkName as ForkPostDeneb];

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
