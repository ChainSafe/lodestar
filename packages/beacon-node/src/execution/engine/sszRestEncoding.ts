import {ByteListType, ByteVectorType, ContainerType, ListCompositeType, UintNumberType} from "@chainsafe/ssz";
import {
  CELLS_PER_EXT_BLOB,
  CONSOLIDATION_REQUEST_TYPE,
  DEPOSIT_REQUEST_TYPE,
  ForkName,
  ForkSeq,
  MAX_BLOB_COMMITMENTS_PER_BLOCK,
  MAX_BYTES_PER_TRANSACTION,
  WITHDRAWAL_REQUEST_TYPE,
} from "@lodestar/params";
import {ExecutionPayload, ExecutionRequests, RootHex, ssz} from "@lodestar/types";
import type {BlobAndProof} from "@lodestar/types/deneb";
import type {BlobAndProofV2} from "@lodestar/types/fulu";
import {fromHex, toHex} from "@lodestar/utils";
import {ExecutionPayloadStatus, PayloadAttributes, VersionedHashes} from "./interface.js";
import {PayloadId} from "./payloadIdCache.js";

// Spec constants from ethereum/execution-apis#764 not exported by @lodestar/params.
const MAX_BLOB_HASHES_REQUEST = 128;
const MAX_EXECUTION_REQUESTS = 256;
const MAX_ERROR_MESSAGE_LENGTH = 1024;
const MAX_CAPABILITY_NAME_LENGTH = 64;
const MAX_CAPABILITIES = 64;
const BLOB_SIZE = 131072;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const Uint8 = new UintNumberType(1);
const Bytes8 = new ByteVectorType(8);
const Bytes20 = new ByteVectorType(20);
const Bytes32 = new ByteVectorType(32);
const Bytes48 = new ByteVectorType(48);

// Nullable wrapper: spec encodes `T or null` as `List[T, 1]` — 0 = absent, 1 = present.
const NullableHash = new ListCompositeType(Bytes32, 1);
const NullablePayloadId = new ListCompositeType(Bytes8, 1);

const ValidationErrorBytes = new ByteListType(MAX_ERROR_MESSAGE_LENGTH);
const TransactionBytes = new ByteListType(MAX_BYTES_PER_TRANSACTION);

const VersionedHashesList = new ListCompositeType(Bytes32, MAX_BLOB_COMMITMENTS_PER_BLOCK);
const BlobHashesRequest = new ListCompositeType(Bytes32, MAX_BLOB_HASHES_REQUEST);

// `execution_requests` is a flat list of opaque byte-lists; each element is
// `type_byte || ssz_bytes`. CL forwards them to the EL without parsing.
const ExecutionRequestsList = new ListCompositeType(TransactionBytes, MAX_EXECUTION_REQUESTS);

// ---------------------------------------------------------------------------
// Fork-independent containers
// ---------------------------------------------------------------------------

const PayloadStatusV1 = new ContainerType(
  {status: Uint8, latestValidHash: NullableHash, validationError: ValidationErrorBytes},
  {typeName: "PayloadStatusV1"}
);

const ForkchoiceStateV1 = new ContainerType(
  {headBlockHash: Bytes32, safeBlockHash: Bytes32, finalizedBlockHash: Bytes32},
  {typeName: "ForkchoiceStateV1"}
);

const ForkchoiceUpdatedResponseV1 = new ContainerType(
  {payloadStatus: PayloadStatusV1, payloadId: NullablePayloadId},
  {typeName: "ForkchoiceUpdatedResponseV1"}
);

const ExchangeCapabilitiesContainer = new ContainerType(
  {capabilities: new ListCompositeType(new ByteListType(MAX_CAPABILITY_NAME_LENGTH), MAX_CAPABILITIES)},
  {typeName: "ExchangeCapabilities"}
);

// ---------------------------------------------------------------------------
// PayloadAttributes (one container per fork)
//
// We cannot reuse `ssz.{fork}.PayloadAttributes` from @lodestar/types because
// they declare `suggestedFeeRecipient: stringType` — a JSON-only marker that
// throws on SSZ serialization.
// ---------------------------------------------------------------------------

const PayloadAttributesV1Container = new ContainerType(
  {timestamp: ssz.UintNum64, prevRandao: Bytes32, suggestedFeeRecipient: Bytes20},
  {typeName: "PayloadAttributesV1"}
);

const PayloadAttributesV2Container = new ContainerType(
  {...PayloadAttributesV1Container.fields, withdrawals: ssz.capella.Withdrawals},
  {typeName: "PayloadAttributesV2"}
);

const PayloadAttributesV3Container = new ContainerType(
  {...PayloadAttributesV2Container.fields, parentBeaconBlockRoot: Bytes32},
  {typeName: "PayloadAttributesV3"}
);

const PayloadAttributesV4Container = new ContainerType(
  {...PayloadAttributesV3Container.fields, slotNumber: ssz.UintNum64, targetGasLimit: ssz.UintNum64},
  {typeName: "PayloadAttributesV4"}
);

const PayloadAttributesV1Optional = new ListCompositeType(PayloadAttributesV1Container, 1);
const PayloadAttributesV2Optional = new ListCompositeType(PayloadAttributesV2Container, 1);
const PayloadAttributesV3Optional = new ListCompositeType(PayloadAttributesV3Container, 1);
const PayloadAttributesV4Optional = new ListCompositeType(PayloadAttributesV4Container, 1);

// ---------------------------------------------------------------------------
// NewPayload request containers (per version)
// ---------------------------------------------------------------------------

const NewPayloadV1Request = new ContainerType(
  {executionPayload: ssz.bellatrix.ExecutionPayload},
  {typeName: "NewPayloadV1Request"}
);

const NewPayloadV2Request = new ContainerType(
  {executionPayload: ssz.capella.ExecutionPayload},
  {typeName: "NewPayloadV2Request"}
);

const NewPayloadV3Request = new ContainerType(
  {
    executionPayload: ssz.deneb.ExecutionPayload,
    expectedBlobVersionedHashes: VersionedHashesList,
    parentBeaconBlockRoot: Bytes32,
  },
  {typeName: "NewPayloadV3Request"}
);

const NewPayloadV4Request = new ContainerType(
  {
    executionPayload: ssz.deneb.ExecutionPayload,
    expectedBlobVersionedHashes: VersionedHashesList,
    parentBeaconBlockRoot: Bytes32,
    executionRequests: ExecutionRequestsList,
  },
  {typeName: "NewPayloadV4Request"}
);

const NewPayloadV5Request = new ContainerType(
  {
    executionPayload: ssz.gloas.ExecutionPayload,
    expectedBlobVersionedHashes: VersionedHashesList,
    parentBeaconBlockRoot: Bytes32,
    executionRequests: ExecutionRequestsList,
  },
  {typeName: "NewPayloadV5Request"}
);

// ---------------------------------------------------------------------------
// ForkchoiceUpdated request containers
// ---------------------------------------------------------------------------

const ForkchoiceUpdatedV1Request = new ContainerType(
  {forkchoiceState: ForkchoiceStateV1, payloadAttributes: PayloadAttributesV1Optional},
  {typeName: "ForkchoiceUpdatedV1Request"}
);

const ForkchoiceUpdatedV2Request = new ContainerType(
  {forkchoiceState: ForkchoiceStateV1, payloadAttributes: PayloadAttributesV2Optional},
  {typeName: "ForkchoiceUpdatedV2Request"}
);

const ForkchoiceUpdatedV3Request = new ContainerType(
  {forkchoiceState: ForkchoiceStateV1, payloadAttributes: PayloadAttributesV3Optional},
  {typeName: "ForkchoiceUpdatedV3Request"}
);

const ForkchoiceUpdatedV4Request = new ContainerType(
  {forkchoiceState: ForkchoiceStateV1, payloadAttributes: PayloadAttributesV4Optional},
  {typeName: "ForkchoiceUpdatedV4Request"}
);

// ---------------------------------------------------------------------------
// GetPayload response containers
// ---------------------------------------------------------------------------

const GetPayloadResponseV2 = new ContainerType(
  {executionPayload: ssz.capella.ExecutionPayload, blockValue: ssz.UintBn256},
  {typeName: "GetPayloadResponseV2"}
);

const GetPayloadResponseV3 = new ContainerType(
  {
    executionPayload: ssz.deneb.ExecutionPayload,
    blockValue: ssz.UintBn256,
    blobsBundle: ssz.deneb.BlobsBundle,
    shouldOverrideBuilder: ssz.Boolean,
  },
  {typeName: "GetPayloadResponseV3"}
);

const GetPayloadResponseV4 = new ContainerType(
  {
    executionPayload: ssz.deneb.ExecutionPayload,
    blockValue: ssz.UintBn256,
    blobsBundle: ssz.deneb.BlobsBundle,
    shouldOverrideBuilder: ssz.Boolean,
    executionRequests: ExecutionRequestsList,
  },
  {typeName: "GetPayloadResponseV4"}
);

const GetPayloadResponseV5 = new ContainerType(
  {
    executionPayload: ssz.deneb.ExecutionPayload,
    blockValue: ssz.UintBn256,
    blobsBundle: ssz.fulu.BlobsBundle,
    shouldOverrideBuilder: ssz.Boolean,
    executionRequests: ExecutionRequestsList,
  },
  {typeName: "GetPayloadResponseV5"}
);

const GetPayloadResponseV6 = new ContainerType(
  {
    executionPayload: ssz.gloas.ExecutionPayload,
    blockValue: ssz.UintBn256,
    blobsBundle: ssz.fulu.BlobsBundle,
    shouldOverrideBuilder: ssz.Boolean,
    executionRequests: ExecutionRequestsList,
  },
  {typeName: "GetPayloadResponseV6"}
);

// ---------------------------------------------------------------------------
// GetBlobs request / response containers
// ---------------------------------------------------------------------------

const GetBlobsRequest = new ContainerType({blobVersionedHashes: BlobHashesRequest}, {typeName: "GetBlobsRequest"});

const BlobBytes = new ByteVectorType(BLOB_SIZE);

const BlobAndProofV1Container = new ContainerType({blob: BlobBytes, proof: Bytes48}, {typeName: "BlobAndProofV1"});

const BlobAndProofV2Container = new ContainerType(
  {blob: BlobBytes, proofs: new ListCompositeType(Bytes48, CELLS_PER_EXT_BLOB)},
  {typeName: "BlobAndProofV2"}
);

const GetBlobsV1Response = new ContainerType(
  {blobsAndProofs: new ListCompositeType(BlobAndProofV1Container, MAX_BLOB_HASHES_REQUEST)},
  {typeName: "GetBlobsV1Response"}
);

const GetBlobsV2Response = new ContainerType(
  {blobsAndProofs: new ListCompositeType(BlobAndProofV2Container, MAX_BLOB_HASHES_REQUEST)},
  {typeName: "GetBlobsV2Response"}
);

// ---------------------------------------------------------------------------
// Fork → version mapping
// ---------------------------------------------------------------------------

/**
 * REST endpoint version for `engine_newPayload`.
 * Spec: Paris=v1, Shanghai=v2, Cancun=v3, Prague=v4, Amsterdam=v5.
 * Osaka (Fulu) does not bump the newPayload version.
 */
export function newPayloadVersion(fork: ForkName): 1 | 2 | 3 | 4 | 5 {
  const seq = ForkSeq[fork];
  if (seq >= ForkSeq.gloas) return 5;
  if (seq >= ForkSeq.electra) return 4;
  if (seq >= ForkSeq.deneb) return 3;
  if (seq >= ForkSeq.capella) return 2;
  return 1;
}

/**
 * REST endpoint version for `engine_getPayload`.
 * Spec: Paris=v1, Shanghai=v2, Cancun=v3, Prague=v4, Osaka=v5, Amsterdam=v6.
 */
export function getPayloadVersion(fork: ForkName): 1 | 2 | 3 | 4 | 5 | 6 {
  const seq = ForkSeq[fork];
  if (seq >= ForkSeq.gloas) return 6;
  if (seq >= ForkSeq.fulu) return 5;
  if (seq >= ForkSeq.electra) return 4;
  if (seq >= ForkSeq.deneb) return 3;
  if (seq >= ForkSeq.capella) return 2;
  return 1;
}

/**
 * REST endpoint version for `engine_forkchoiceUpdated`.
 * Spec: Paris=v1, Shanghai=v2, Cancun=v3, Amsterdam=v4.
 */
export function forkchoiceUpdatedVersion(fork: ForkName): 1 | 2 | 3 | 4 {
  const seq = ForkSeq[fork];
  if (seq >= ForkSeq.gloas) return 4;
  if (seq >= ForkSeq.deneb) return 3;
  if (seq >= ForkSeq.capella) return 2;
  return 1;
}

/**
 * REST endpoint version for `engine_getBlobs`.
 * Cancun=v1, Osaka=v2 (all-or-nothing variant — matches Lodestar's existing
 * JSON-RPC v2 contract). The spec also defines a v3 with per-element
 * nullability, but Lodestar's IExecutionEngine signature is all-or-nothing.
 */
export function getBlobsVersion(fork: ForkName): 1 | 2 {
  return ForkSeq[fork] >= ForkSeq.fulu ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildExecutionRequestsList(executionRequests: ExecutionRequests): Uint8Array[] {
  const items: Uint8Array[] = [];
  const prefix = (typeByte: number, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(1 + body.length);
    out[0] = typeByte;
    out.set(body, 1);
    return out;
  };
  if (executionRequests.deposits.length > 0) {
    items.push(prefix(DEPOSIT_REQUEST_TYPE, ssz.electra.DepositRequests.serialize(executionRequests.deposits)));
  }
  if (executionRequests.withdrawals.length > 0) {
    items.push(
      prefix(WITHDRAWAL_REQUEST_TYPE, ssz.electra.WithdrawalRequests.serialize(executionRequests.withdrawals))
    );
  }
  if (executionRequests.consolidations.length > 0) {
    items.push(
      prefix(CONSOLIDATION_REQUEST_TYPE, ssz.electra.ConsolidationRequests.serialize(executionRequests.consolidations))
    );
  }
  return items;
}

function parseExecutionRequestsList(items: Uint8Array[]): ExecutionRequests {
  const result: ExecutionRequests = {deposits: [], withdrawals: [], consolidations: []};
  for (const item of items) {
    if (item.length === 0) throw Error("Execution request with empty data");
    const type = item[0];
    const body = item.subarray(1);
    switch (type) {
      case DEPOSIT_REQUEST_TYPE:
        result.deposits = ssz.electra.DepositRequests.deserialize(body);
        break;
      case WITHDRAWAL_REQUEST_TYPE:
        result.withdrawals = ssz.electra.WithdrawalRequests.deserialize(body);
        break;
      case CONSOLIDATION_REQUEST_TYPE:
        result.consolidations = ssz.electra.ConsolidationRequests.deserialize(body);
        break;
      default:
        throw Error(`Unknown execution request type=${type}`);
    }
  }
  return result;
}

function buildPayloadAttributesValue(fork: ForkName, attrs: PayloadAttributes): Record<string, unknown> {
  const seq = ForkSeq[fork];
  const base = {
    timestamp: attrs.timestamp,
    prevRandao: attrs.prevRandao,
    suggestedFeeRecipient: fromHex(attrs.suggestedFeeRecipient),
  };
  if (seq < ForkSeq.capella) return base;
  const v2 = {...base, withdrawals: attrs.withdrawals ?? []};
  if (seq < ForkSeq.deneb) return v2;
  if (attrs.parentBeaconBlockRoot === undefined) {
    throw Error(`parentBeaconBlockRoot required in PayloadAttributes for fork=${fork}`);
  }
  const v3 = {...v2, parentBeaconBlockRoot: attrs.parentBeaconBlockRoot};
  if (seq < ForkSeq.gloas) return v3;
  if (attrs.slotNumber === undefined) {
    throw Error(`slotNumber required in PayloadAttributes for fork=${fork}`);
  }
  if (attrs.targetGasLimit === undefined) {
    throw Error(`targetGasLimit required in PayloadAttributes for fork=${fork}`);
  }
  return {...v3, slotNumber: attrs.slotNumber, targetGasLimit: attrs.targetGasLimit};
}

function statusByteToEnum(byte: number): ExecutionPayloadStatus {
  switch (byte) {
    case 0:
      return ExecutionPayloadStatus.VALID;
    case 1:
      return ExecutionPayloadStatus.INVALID;
    case 2:
      return ExecutionPayloadStatus.SYNCING;
    case 3:
      return ExecutionPayloadStatus.ACCEPTED;
    default:
      throw Error(`Unknown payload status byte=${byte}`);
  }
}

// ---------------------------------------------------------------------------
// Public encoders
// ---------------------------------------------------------------------------

export function encodeNewPayloadRequest(
  fork: ForkName,
  executionPayload: ExecutionPayload,
  versionedHashes?: VersionedHashes,
  parentBeaconBlockRoot?: Uint8Array,
  executionRequests?: ExecutionRequests
): Uint8Array {
  const version = newPayloadVersion(fork);

  if (version === 1) {
    return NewPayloadV1Request.serialize({executionPayload} as never);
  }
  if (version === 2) {
    return NewPayloadV2Request.serialize({executionPayload} as never);
  }

  if (versionedHashes === undefined || parentBeaconBlockRoot === undefined) {
    throw Error(`versionedHashes and parentBeaconBlockRoot required for newPayload v${version}`);
  }

  if (version === 3) {
    return NewPayloadV3Request.serialize({
      executionPayload,
      expectedBlobVersionedHashes: versionedHashes,
      parentBeaconBlockRoot,
    } as never);
  }

  if (executionRequests === undefined) {
    throw Error(`executionRequests required for newPayload v${version}`);
  }
  const requestsList = buildExecutionRequestsList(executionRequests);

  if (version === 4) {
    return NewPayloadV4Request.serialize({
      executionPayload,
      expectedBlobVersionedHashes: versionedHashes,
      parentBeaconBlockRoot,
      executionRequests: requestsList,
    } as never);
  }

  return NewPayloadV5Request.serialize({
    executionPayload,
    expectedBlobVersionedHashes: versionedHashes,
    parentBeaconBlockRoot,
    executionRequests: requestsList,
  } as never);
}

export function encodeForkchoiceUpdatedRequest(
  fork: ForkName,
  headBlockHash: Uint8Array,
  safeBlockHash: Uint8Array,
  finalizedBlockHash: Uint8Array,
  attributes?: PayloadAttributes
): Uint8Array {
  const version = forkchoiceUpdatedVersion(fork);
  const forkchoiceState = {headBlockHash, safeBlockHash, finalizedBlockHash};
  const payloadAttributes = attributes ? [buildPayloadAttributesValue(fork, attributes)] : [];

  switch (version) {
    case 1:
      return ForkchoiceUpdatedV1Request.serialize({forkchoiceState, payloadAttributes} as never);
    case 2:
      return ForkchoiceUpdatedV2Request.serialize({forkchoiceState, payloadAttributes} as never);
    case 3:
      return ForkchoiceUpdatedV3Request.serialize({forkchoiceState, payloadAttributes} as never);
    case 4:
      return ForkchoiceUpdatedV4Request.serialize({forkchoiceState, payloadAttributes} as never);
  }
}

export function encodeGetBlobsRequest(versionedHashes: VersionedHashes): Uint8Array {
  return GetBlobsRequest.serialize({blobVersionedHashes: versionedHashes});
}

export function encodeExchangeCapabilities(capabilities: string[]): Uint8Array {
  const encoder = new TextEncoder();
  return ExchangeCapabilitiesContainer.serialize({
    capabilities: capabilities.map((s) => encoder.encode(s)),
  });
}

// ---------------------------------------------------------------------------
// Public decoders
// ---------------------------------------------------------------------------

export interface DecodedPayloadStatus {
  status: ExecutionPayloadStatus;
  latestValidHash: RootHex | null;
  validationError: string | null;
}

export function decodePayloadStatus(data: Uint8Array): DecodedPayloadStatus {
  const parsed = PayloadStatusV1.deserialize(data);
  const validationError = parsed.validationError.length > 0 ? new TextDecoder().decode(parsed.validationError) : null;
  return {
    status: statusByteToEnum(parsed.status),
    latestValidHash: parsed.latestValidHash.length === 1 ? toHex(parsed.latestValidHash[0]) : null,
    validationError,
  };
}

export interface DecodedForkchoiceUpdatedResponse {
  payloadStatus: DecodedPayloadStatus;
  payloadId: PayloadId | null;
}

export function decodeForkchoiceUpdatedResponse(data: Uint8Array): DecodedForkchoiceUpdatedResponse {
  const parsed = ForkchoiceUpdatedResponseV1.deserialize(data);
  const validationError =
    parsed.payloadStatus.validationError.length > 0
      ? new TextDecoder().decode(parsed.payloadStatus.validationError)
      : null;
  return {
    payloadStatus: {
      status: statusByteToEnum(parsed.payloadStatus.status),
      latestValidHash:
        parsed.payloadStatus.latestValidHash.length === 1 ? toHex(parsed.payloadStatus.latestValidHash[0]) : null,
      validationError,
    },
    payloadId: parsed.payloadId.length === 1 ? toHex(parsed.payloadId[0]) : null,
  };
}

export interface DecodedGetPayloadResponse {
  executionPayload: ExecutionPayload;
  blockValue: bigint;
  blobsBundle?: import("@lodestar/types").BlobsBundle;
  shouldOverrideBuilder: boolean;
  executionRequests?: ExecutionRequests;
}

export function decodeGetPayloadResponse(fork: ForkName, data: Uint8Array): DecodedGetPayloadResponse {
  const version = getPayloadVersion(fork);

  // v1 is the raw ExecutionPayloadV1 with no wrapping container — no block
  // value, no blobs bundle. Lodestar does not produce v1 traffic but we keep
  // the branch for completeness.
  if (version === 1) {
    return {
      executionPayload: ssz.bellatrix.ExecutionPayload.deserialize(data) as ExecutionPayload,
      blockValue: 0n,
      shouldOverrideBuilder: false,
    };
  }

  if (version === 2) {
    const parsed = GetPayloadResponseV2.deserialize(data);
    return {
      executionPayload: parsed.executionPayload as ExecutionPayload,
      blockValue: parsed.blockValue,
      shouldOverrideBuilder: false,
    };
  }

  if (version === 3) {
    const parsed = GetPayloadResponseV3.deserialize(data);
    return {
      executionPayload: parsed.executionPayload as ExecutionPayload,
      blockValue: parsed.blockValue,
      blobsBundle: parsed.blobsBundle,
      shouldOverrideBuilder: parsed.shouldOverrideBuilder,
    };
  }

  if (version === 4) {
    const parsed = GetPayloadResponseV4.deserialize(data);
    return {
      executionPayload: parsed.executionPayload as ExecutionPayload,
      blockValue: parsed.blockValue,
      blobsBundle: parsed.blobsBundle,
      shouldOverrideBuilder: parsed.shouldOverrideBuilder,
      executionRequests: parseExecutionRequestsList(parsed.executionRequests),
    };
  }

  if (version === 5) {
    const parsed = GetPayloadResponseV5.deserialize(data);
    return {
      executionPayload: parsed.executionPayload as ExecutionPayload,
      blockValue: parsed.blockValue,
      blobsBundle: parsed.blobsBundle,
      shouldOverrideBuilder: parsed.shouldOverrideBuilder,
      executionRequests: parseExecutionRequestsList(parsed.executionRequests),
    };
  }

  // v6
  const parsed = GetPayloadResponseV6.deserialize(data);
  return {
    executionPayload: parsed.executionPayload as ExecutionPayload,
    blockValue: parsed.blockValue,
    blobsBundle: parsed.blobsBundle,
    shouldOverrideBuilder: parsed.shouldOverrideBuilder,
    executionRequests: parseExecutionRequestsList(parsed.executionRequests),
  };
}

export function decodeGetBlobsV1Response(data: Uint8Array): BlobAndProof[] {
  const parsed = GetBlobsV1Response.deserialize(data);
  return parsed.blobsAndProofs.map((item) => ({blob: item.blob, proof: item.proof}));
}

export function decodeGetBlobsV2Response(data: Uint8Array): BlobAndProofV2[] {
  const parsed = GetBlobsV2Response.deserialize(data);
  return parsed.blobsAndProofs.map((item) => ({blob: item.blob, proofs: item.proofs}));
}

export function decodeExchangeCapabilities(data: Uint8Array): string[] {
  const parsed = ExchangeCapabilitiesContainer.deserialize(data);
  const decoder = new TextDecoder();
  return parsed.capabilities.map((bytes) => decoder.decode(bytes));
}
