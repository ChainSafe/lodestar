/**
 * SSZ-REST (EIP-8161) encoding and decoding functions for the Engine API.
 *
 * All multi-byte integers are little-endian (LE). DataView is used for reading
 * and writing to ensure correctness regardless of platform endianness.
 */

import {ByteListType, ContainerType, ListCompositeType} from "@chainsafe/ssz";
import {ForkName, ForkSeq} from "@lodestar/params";
import {
  ExecutionPayload,
  ExecutionRequests,
  Root,
  ssz,
  bellatrix,
  capella,
  deneb,
  electra,
} from "@lodestar/types";
import {PayloadAttributes, VersionedHashes} from "./interface.js";

// SSZ type: Container { capabilities: List[List[uint8, 64], 128] }
const Capability = new ByteListType(64);
const ExchangeCapabilitiesRequest = new ContainerType({
  capabilities: new ListCompositeType(Capability, 128),
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function writeUint32LE(buf: Uint8Array, offset: number, value: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, value, true);
}

function readUint32LE(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return view.getUint32(offset, true);
}

function writeUint64LE(buf: Uint8Array, offset: number, value: bigint): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setBigUint64(offset, value, true);
}

function readUint64LE(buf: Uint8Array, offset: number): bigint {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return view.getBigUint64(offset, true);
}

function writeUint256LE(buf: Uint8Array, offset: number, value: bigint): void {
  // Write 256-bit LE as 4x 64-bit LE words
  for (let i = 0; i < 4; i++) {
    writeUint64LE(buf, offset + i * 8, value & 0xffffffffffffffffn);
    value >>= 64n;
  }
}

function readUint256LE(buf: Uint8Array, offset: number): bigint {
  let result = 0n;
  for (let i = 3; i >= 0; i--) {
    result = (result << 64n) | readUint64LE(buf, offset + i * 8);
  }
  return result;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Encode functions
// ---------------------------------------------------------------------------

/**
 * Encode ForkchoiceState: headBlockHash(32) + safeBlockHash(32) + finalizedBlockHash(32) = 96 bytes
 */
export function encodeForkchoiceState(
  headBlockHash: Uint8Array,
  safeBlockHash: Uint8Array,
  finalizedBlockHash: Uint8Array
): Uint8Array {
  const buf = new Uint8Array(96);
  buf.set(headBlockHash, 0);
  buf.set(safeBlockHash, 32);
  buf.set(finalizedBlockHash, 64);
  return buf;
}

/**
 * Encode a ForkchoiceUpdated request.
 *
 * Layout: ForkchoiceState(96 fixed) + attributes_offset(4) + optional Union[None, PayloadAttributes]
 *
 * Union encoding: if None, offset points to end of data.
 * If present: selector byte 1 + PayloadAttributes SSZ.
 *
 * PayloadAttributes V3: timestamp(8) + prevRandao(32) + suggestedFeeRecipient(20)
 *   + withdrawals_offset(4) + parentBeaconBlockRoot(32) + withdrawals list
 *
 * Each withdrawal: index(8) + validatorIndex(8) + address(20) + amount(8) = 44 bytes
 */
export function encodeForkchoiceUpdatedRequest(
  headBlockHash: Uint8Array,
  safeBlockHash: Uint8Array,
  finalizedBlockHash: Uint8Array,
  attributes?: PayloadAttributes
): Uint8Array {
  // Fixed part: 96 (forkchoice state) + 4 (attributes offset) = 100
  const FIXED_SIZE = 100;

  if (!attributes) {
    // No attributes: offset points to end, no variable data
    const buf = new Uint8Array(FIXED_SIZE);
    buf.set(headBlockHash, 0);
    buf.set(safeBlockHash, 32);
    buf.set(finalizedBlockHash, 64);
    writeUint32LE(buf, 96, FIXED_SIZE); // offset to end = None union
    return buf;
  }

  // Encode PayloadAttributes
  const feeRecipientBytes = hexToBytes20(attributes.suggestedFeeRecipient);
  const withdrawals = attributes.withdrawals ?? [];
  const parentBeaconBlockRoot = attributes.parentBeaconBlockRoot;

  // PayloadAttributes fixed part: timestamp(8) + prevRandao(32) + suggestedFeeRecipient(20)
  //   + withdrawals_offset(4) + parentBeaconBlockRoot(32) = 96
  const ATTR_FIXED = 96;
  const withdrawalsSize = withdrawals.length * 44;
  const attrTotalSize = ATTR_FIXED + withdrawalsSize;

  // Total: FIXED_SIZE + 1 (union selector) + attrTotalSize
  const totalSize = FIXED_SIZE + 1 + attrTotalSize;
  const buf = new Uint8Array(totalSize);

  // ForkchoiceState
  buf.set(headBlockHash, 0);
  buf.set(safeBlockHash, 32);
  buf.set(finalizedBlockHash, 64);

  // Offset to attributes union
  writeUint32LE(buf, 96, FIXED_SIZE);

  // Union selector: 1 = present
  let pos = FIXED_SIZE;
  buf[pos] = 1;
  pos += 1;

  // PayloadAttributes
  const attrStart = pos;
  writeUint64LE(buf, pos, BigInt(attributes.timestamp));
  pos += 8;
  buf.set(attributes.prevRandao, pos);
  pos += 32;
  buf.set(feeRecipientBytes, pos);
  pos += 20;
  // withdrawals_offset: relative to attrStart
  writeUint32LE(buf, pos, ATTR_FIXED);
  pos += 4;
  if (parentBeaconBlockRoot) {
    buf.set(parentBeaconBlockRoot, pos);
  }
  pos += 32;

  // Withdrawals
  for (const w of withdrawals) {
    writeUint64LE(buf, pos, BigInt(w.index));
    pos += 8;
    writeUint64LE(buf, pos, BigInt(w.validatorIndex));
    pos += 8;
    buf.set(w.address, pos);
    pos += 20;
    writeUint64LE(buf, pos, BigInt(w.amount));
    pos += 8;
  }

  return buf;
}

/**
 * Encode a NewPayload request.
 *
 * V1/V2: just the ExecutionPayload SSZ bytes
 * V3: payload_offset(4) + hashes_offset(4) + parentBeaconBlockRoot(32 fixed) + payload SSZ + hashes (32 each)
 * V4: V3 layout + requests_offset(4) + execution_requests SSZ
 */
export function encodeNewPayloadRequest(
  fork: ForkName,
  executionPayload: ExecutionPayload,
  versionedHashes?: VersionedHashes,
  parentBeaconBlockRoot?: Root,
  executionRequests?: ExecutionRequests
): Uint8Array {
  // Serialize the execution payload using lodestar SSZ codecs
  const payloadSsz = serializeExecutionPayloadSsz(fork, executionPayload);

  const forkSeq = ForkSeq[fork];

  if (forkSeq < ForkSeq.deneb) {
    // V1/V2: just the raw payload bytes
    return payloadSsz;
  }

  if (!versionedHashes) throw Error("versionedHashes required for deneb+");
  if (!parentBeaconBlockRoot) throw Error("parentBeaconBlockRoot required for deneb+");

  const hashesBytes = versionedHashes.length * 32;

  if (forkSeq >= ForkSeq.electra && executionRequests) {
    // V4: payload_offset(4) + hashes_offset(4) + parentBeaconBlockRoot(32) + requests_offset(4) = 44 fixed
    const FIXED_SIZE = 44;

    const requestsSsz = serializeExecutionRequestsSsz(executionRequests);

    const payloadOffset = FIXED_SIZE;
    const hashesOffset = payloadOffset + payloadSsz.length;
    const requestsOffset = hashesOffset + hashesBytes;

    const totalSize = requestsOffset + requestsSsz.length;
    const buf = new Uint8Array(totalSize);

    writeUint32LE(buf, 0, payloadOffset);
    writeUint32LE(buf, 4, hashesOffset);
    buf.set(parentBeaconBlockRoot, 8);
    writeUint32LE(buf, 40, requestsOffset);

    buf.set(payloadSsz, payloadOffset);

    let pos = hashesOffset;
    for (const hash of versionedHashes) {
      buf.set(hash, pos);
      pos += 32;
    }

    buf.set(requestsSsz, requestsOffset);
    return buf;
  }

  // V3: payload_offset(4) + hashes_offset(4) + parentBeaconBlockRoot(32) = 40 fixed
  const FIXED_SIZE = 40;
  const payloadOffset = FIXED_SIZE;
  const hashesOffset = payloadOffset + payloadSsz.length;

  const totalSize = hashesOffset + hashesBytes;
  const buf = new Uint8Array(totalSize);

  writeUint32LE(buf, 0, payloadOffset);
  writeUint32LE(buf, 4, hashesOffset);
  buf.set(parentBeaconBlockRoot, 8);

  buf.set(payloadSsz, payloadOffset);

  let pos = hashesOffset;
  for (const hash of versionedHashes) {
    buf.set(hash, pos);
    pos += 32;
  }

  return buf;
}

/**
 * Encode a GetPayload request: just the 8-byte payload ID.
 */
export function encodeGetPayloadRequest(payloadId: Uint8Array): Uint8Array {
  if (payloadId.length !== 8) {
    throw Error(`Invalid payloadId length ${payloadId.length}, expected 8`);
  }
  return payloadId;
}

/**
 * Encode a GetBlobs request.
 * Container: hashes_offset(4) + concatenated 32-byte hashes
 */
export function encodeGetBlobsRequest(versionedHashes: VersionedHashes): Uint8Array {
  const FIXED_SIZE = 4;
  const hashesSize = versionedHashes.length * 32;
  const buf = new Uint8Array(FIXED_SIZE + hashesSize);
  writeUint32LE(buf, 0, FIXED_SIZE);
  let pos = FIXED_SIZE;
  for (const hash of versionedHashes) {
    buf.set(hash, pos);
    pos += 32;
  }
  return buf;
}

/**
 * Encode ExchangeCapabilities as SSZ Container { capabilities: List[List[uint8, 64], 128] }.
 */
export function encodeExchangeCapabilities(capabilities: string[]): Uint8Array {
  return ExchangeCapabilitiesRequest.serialize({
    capabilities: capabilities.map((s) => textEncoder.encode(s)),
  });
}

// ---------------------------------------------------------------------------
// Decode functions
// ---------------------------------------------------------------------------

/** Status byte mapping */
const PAYLOAD_STATUS_MAP: Record<number, string> = {
  0: "VALID",
  1: "INVALID",
  2: "SYNCING",
  3: "ACCEPTED",
  4: "INVALID_BLOCK_HASH",
};

export interface DecodedPayloadStatus {
  status: string;
  latestValidHash: string | null;
  validationError: string | null;
}

/**
 * Decode PayloadStatus from SSZ-REST response.
 *
 * Layout:
 *   Byte 0: status (0=VALID, 1=INVALID, 2=SYNCING, 3=ACCEPTED, 4=INVALID_BLOCK_HASH)
 *   Bytes 1-4: latestValidHash offset (uint32 LE)
 *   Bytes 5-8: validationError offset (uint32 LE)
 *   Variable: latestValidHash as Union (selector byte 0=None, 1=present + 32 bytes)
 *   Variable: validationError as UTF-8 bytes
 */
export function decodePayloadStatus(data: Uint8Array): DecodedPayloadStatus {
  if (data.length < 9) {
    throw Error(`PayloadStatus too short: ${data.length} bytes, expected at least 9`);
  }

  const statusByte = data[0];
  const status = PAYLOAD_STATUS_MAP[statusByte];
  if (status === undefined) {
    throw Error(`Unknown payload status byte: ${statusByte}`);
  }

  const latestValidHashOffset = readUint32LE(data, 1);
  const validationErrorOffset = readUint32LE(data, 5);

  // Decode latestValidHash (Union)
  let latestValidHash: string | null = null;
  if (latestValidHashOffset < data.length) {
    const selector = data[latestValidHashOffset];
    if (selector === 1) {
      // 32-byte hash present
      const hashBytes = data.subarray(latestValidHashOffset + 1, latestValidHashOffset + 33);
      latestValidHash = "0x" + bytesToHex(hashBytes);
    }
    // selector === 0 means None
  }

  // Decode validationError
  let validationError: string | null = null;
  if (validationErrorOffset < data.length) {
    const errorBytes = data.subarray(validationErrorOffset);
    if (errorBytes.length > 0) {
      validationError = textDecoder.decode(errorBytes);
    }
  }

  return {status, latestValidHash, validationError};
}

export interface DecodedForkchoiceUpdatedResponse {
  payloadStatus: DecodedPayloadStatus;
  payloadId: string | null;
}

/**
 * Decode ForkchoiceUpdated response.
 *
 * Layout:
 *   Bytes 0-3: payloadStatus offset
 *   Bytes 4-7: payloadId offset
 *   Variable: payloadStatus (decoded with decodePayloadStatus)
 *   Variable: payloadId as Union (selector 0=None, 1=present + 8 bytes)
 */
export function decodeForkchoiceUpdatedResponse(data: Uint8Array): DecodedForkchoiceUpdatedResponse {
  if (data.length < 8) {
    throw Error(`ForkchoiceUpdatedResponse too short: ${data.length} bytes, expected at least 8`);
  }

  const payloadStatusOffset = readUint32LE(data, 0);
  const payloadIdOffset = readUint32LE(data, 4);

  // Determine payloadStatus extent
  const payloadStatusEnd = payloadIdOffset < data.length ? payloadIdOffset : data.length;
  const payloadStatusBytes = data.subarray(payloadStatusOffset, payloadStatusEnd);
  const payloadStatus = decodePayloadStatus(payloadStatusBytes);

  // Decode payloadId (Union)
  let payloadId: string | null = null;
  if (payloadIdOffset < data.length) {
    const selector = data[payloadIdOffset];
    if (selector === 1) {
      const idBytes = data.subarray(payloadIdOffset + 1, payloadIdOffset + 9);
      payloadId = "0x" + bytesToHex(idBytes);
    }
  }

  return {payloadStatus, payloadId};
}

export interface DecodedGetPayloadResponse {
  /** Raw SSZ bytes of the ExecutionPayload */
  executionPayloadSsz: Uint8Array;
  /** Block value as bigint (uint256 LE) */
  blockValue: bigint;
  /** Raw SSZ bytes of the BlobsBundle, may be empty */
  blobsBundleSsz: Uint8Array;
  /** Whether the builder should be overridden */
  shouldOverrideBuilder: boolean;
  /** Raw SSZ bytes of execution requests, may be empty */
  executionRequestsSsz: Uint8Array;
}

/**
 * Decode GetPayload response.
 *
 * Layout:
 *   Bytes 0-3:   executionPayload offset
 *   Bytes 4-35:  blockValue (uint256 LE, 32 bytes)
 *   Bytes 36-39: blobsBundle offset
 *   Byte 40:     shouldOverrideBuilder (boolean)
 *   Bytes 41-44: executionRequests offset
 *
 * Fixed header = 45 bytes (if executionRequests field present) or 41 bytes (without)
 */
export function decodeGetPayloadResponse(data: Uint8Array): DecodedGetPayloadResponse {
  // Determine layout based on data length and offsets
  // Minimum: 41 bytes without executionRequests
  if (data.length < 41) {
    throw Error(`GetPayloadResponse too short: ${data.length} bytes, expected at least 41`);
  }

  const executionPayloadOffset = readUint32LE(data, 0);
  const blockValue = readUint256LE(data, 4);
  const blobsBundleOffset = readUint32LE(data, 36);
  const shouldOverrideBuilder = data[40] !== 0;

  let executionRequestsOffset: number;
  let hasExecutionRequests = false;

  // If executionPayloadOffset >= 45, we have the executionRequests offset field
  if (executionPayloadOffset >= 45 && data.length >= 45) {
    executionRequestsOffset = readUint32LE(data, 41);
    hasExecutionRequests = true;
  } else {
    executionRequestsOffset = data.length;
  }

  // Extract regions
  const executionPayloadSsz = data.subarray(executionPayloadOffset, blobsBundleOffset);
  const blobsBundleEnd = hasExecutionRequests ? executionRequestsOffset : data.length;
  const blobsBundleSsz = data.subarray(blobsBundleOffset, blobsBundleEnd);
  const executionRequestsSsz = hasExecutionRequests ? data.subarray(executionRequestsOffset) : new Uint8Array(0);

  return {
    executionPayloadSsz,
    blockValue,
    blobsBundleSsz,
    shouldOverrideBuilder,
    executionRequestsSsz,
  };
}

/**
 * Decode ExchangeCapabilities response (SSZ Container with List[List[uint8, 64], 128]).
 */
export function decodeExchangeCapabilities(data: Uint8Array): string[] {
  if (data.length < 4) {
    return [];
  }
  try {
    const decoded = ExchangeCapabilitiesRequest.deserialize(data);
    return decoded.capabilities.map((cap) => textDecoder.decode(cap));
  } catch {
    return [];
  }
}

export interface DecodedBlobAndProof {
  blob: Uint8Array;
  kzgProof: Uint8Array;
}

/**
 * Decode GetBlobs response: returns array of {blob, kzgProof}.
 *
 * Layout: list_offset(4) + N item_offsets(4 each) + items
 * Each item: blob(131072 bytes) + proof(48 bytes)
 */
export function decodeGetBlobsResponse(data: Uint8Array): DecodedBlobAndProof[] {
  if (data.length < 4) {
    return [];
  }

  const listOffset = readUint32LE(data, 0);
  if (listOffset >= data.length) {
    return [];
  }

  const listData = data.subarray(listOffset);
  if (listData.length === 0) {
    return [];
  }

  // Each blob+proof is fixed size: 131072 + 48 = 131120 bytes
  const BLOB_SIZE = 131072;
  const PROOF_SIZE = 48;
  const ITEM_SIZE = BLOB_SIZE + PROOF_SIZE;

  const numItems = Math.floor(listData.length / ITEM_SIZE);
  const result: DecodedBlobAndProof[] = [];

  for (let i = 0; i < numItems; i++) {
    const itemStart = i * ITEM_SIZE;
    result.push({
      blob: listData.subarray(itemStart, itemStart + BLOB_SIZE),
      kzgProof: listData.subarray(itemStart + BLOB_SIZE, itemStart + ITEM_SIZE),
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// SSZ serialization helpers
// ---------------------------------------------------------------------------

/**
 * Serialize an ExecutionPayload to SSZ bytes using the @lodestar/types codec
 * appropriate for the given fork.
 */
function serializeExecutionPayloadSsz(fork: ForkName, payload: ExecutionPayload): Uint8Array {
  const forkSeq = ForkSeq[fork];
  if (forkSeq >= ForkSeq.electra) {
    return ssz.electra.ExecutionPayload.serialize(payload as unknown as electra.ExecutionPayload);
  }
  if (forkSeq >= ForkSeq.deneb) {
    return ssz.deneb.ExecutionPayload.serialize(payload as unknown as deneb.ExecutionPayload);
  }
  if (forkSeq >= ForkSeq.capella) {
    return ssz.capella.ExecutionPayload.serialize(payload as unknown as capella.ExecutionPayload);
  }
  return ssz.bellatrix.ExecutionPayload.serialize(payload as unknown as bellatrix.ExecutionPayload);
}

/**
 * Serialize ExecutionRequests to a single SSZ byte array.
 * Concatenates the type-prefixed request lists.
 */
function serializeExecutionRequestsSsz(executionRequests: ExecutionRequests): Uint8Array {
  const parts: Uint8Array[] = [];

  if (executionRequests.deposits.length > 0) {
    const bytes = ssz.electra.DepositRequests.serialize(executionRequests.deposits);
    const prefixed = new Uint8Array(1 + bytes.length);
    prefixed[0] = 0x00; // DEPOSIT_REQUEST_TYPE
    prefixed.set(bytes, 1);
    parts.push(prefixed);
  }

  if (executionRequests.withdrawals.length > 0) {
    const bytes = ssz.electra.WithdrawalRequests.serialize(executionRequests.withdrawals);
    const prefixed = new Uint8Array(1 + bytes.length);
    prefixed[0] = 0x01; // WITHDRAWAL_REQUEST_TYPE
    prefixed.set(bytes, 1);
    parts.push(prefixed);
  }

  if (executionRequests.consolidations.length > 0) {
    const bytes = ssz.electra.ConsolidationRequests.serialize(executionRequests.consolidations);
    const prefixed = new Uint8Array(1 + bytes.length);
    prefixed[0] = 0x02; // CONSOLIDATION_REQUEST_TYPE
    prefixed.set(bytes, 1);
    parts.push(prefixed);
  }

  // Concatenate
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

function hexToBytes20(hex: string): Uint8Array {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (stripped.length !== 40) {
    throw Error(`Expected 20-byte hex address, got ${stripped.length / 2} bytes`);
  }
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    bytes[i] = parseInt(stripped.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
