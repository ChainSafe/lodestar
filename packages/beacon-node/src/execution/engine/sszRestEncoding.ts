import {
  BitVectorType,
  BooleanType,
  ByteListType,
  ByteVectorType,
  ContainerType,
  ListCompositeType,
  UintNumberType,
} from "@chainsafe/ssz";
import {
  BUILDER_DEPOSIT_REQUEST_TYPE,
  BUILDER_EXIT_REQUEST_TYPE,
  CELLS_PER_EXT_BLOB,
  CONSOLIDATION_REQUEST_TYPE,
  DEPOSIT_REQUEST_TYPE,
  ForkName,
  ForkSeq,
  MAX_BYTES_PER_TRANSACTION,
  MAX_TRANSACTIONS_PER_PAYLOAD,
  WITHDRAWAL_REQUEST_TYPE,
} from "@lodestar/params";
import {BlobsBundle, ExecutionPayload, ExecutionRequests, RootHex, gloas, ssz} from "@lodestar/types";
import type {BlobAndProof} from "@lodestar/types/deneb";
import type {BlobAndProofV2} from "@lodestar/types/fulu";
import {fromHex, toHex} from "@lodestar/utils";
import {ExecutionPayloadStatus, PayloadAttributes} from "./interface.js";
import {PayloadId} from "./payloadIdCache.js";
import {BLOB_AND_PROOF_V2_RPC_BYTES, ClientVersionRpc, ExecutionPayloadBody} from "./types.js";

// ---------------------------------------------------------------------------
// EL fork names — the `Eth-Execution-Version` header values.
// ethereum/execution-apis src/engine/refactor.md § Versioning model
// ---------------------------------------------------------------------------

export type ElForkName = "paris" | "shanghai" | "cancun" | "prague" | "osaka" | "amsterdam";

export const EL_FORK_NAMES: readonly ElForkName[] = ["paris", "shanghai", "cancun", "prague", "osaka", "amsterdam"];

const CL_TO_EL_FORK: Partial<Record<ForkName, ElForkName>> = {
  [ForkName.bellatrix]: "paris",
  [ForkName.capella]: "shanghai",
  [ForkName.deneb]: "cancun",
  [ForkName.electra]: "prague",
  [ForkName.fulu]: "osaka",
  [ForkName.gloas]: "amsterdam",
};

/**
 * Lodestar's `ForkName` has no BPO entries, so the spec rule "a BPO era negotiates
 * as its base named fork" holds by construction.
 */
export function clForkToElFork(fork: ForkName): ElForkName {
  const elFork = CL_TO_EL_FORK[fork];
  if (elFork === undefined) {
    throw Error(`No Engine API fork for CL fork=${fork}`);
  }
  return elFork;
}

// ---------------------------------------------------------------------------
// MAX_* constants — refactor-ssz.md § MAX_* constants.
// Values not exported by @lodestar/params are pinned here.
// ---------------------------------------------------------------------------

/** MAX_VERSIONED_HASHES_PER_REQUEST / MAX_BLOBS_REQUEST */
export const MAX_BLOBS_REQUEST = 128;
/** MAX_BODIES_REQUEST */
export const MAX_BODIES_REQUEST = 32;
/** MAX_EXECUTION_REQUESTS_PER_PAYLOAD */
const MAX_EXECUTION_REQUESTS_PER_PAYLOAD = 256;
/** MAX_BYTES_PER_EXECUTION_REQUEST — spec placeholder: reuses the tx bound */
const MAX_BYTES_PER_EXECUTION_REQUEST = MAX_BYTES_PER_TRANSACTION;
/** MAX_BAL_BYTES — spec placeholder until EIP-7928 pins a bound */
const MAX_BAL_BYTES = MAX_BYTES_PER_TRANSACTION;
/** MAX_ERROR_BYTES */
const MAX_ERROR_BYTES = 1024;
/** BYTES_PER_BLOB */
const BYTES_PER_BLOB = 131072;
/** MAX_REQUEST_BODY_SIZE — advertised as limits.payload.max_bytes */
export const MAX_REQUEST_BODY_SIZE = 2 ** 26;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const Uint8 = new UintNumberType(1);
// biome-ignore lint/suspicious/noShadowRestrictedNames: SSZ BooleanType instance, mirrors ssz.Boolean naming
const Boolean = new BooleanType();
const Bytes8 = new ByteVectorType(8);
const Bytes20 = new ByteVectorType(20);
const Bytes32 = new ByteVectorType(32);
const Bytes48 = new ByteVectorType(48);

/** `Optional[T]` ≡ `List[T, 1]` — refactor.md § SSZ encoding conventions */
const OptionalBytes32 = new ListCompositeType(Bytes32, 1);
const OptionalBytes8 = new ListCompositeType(Bytes8, 1);
/** `String` ≡ `ByteList[MAX_ERROR_BYTES]` */
const StringBytes = new ByteListType(MAX_ERROR_BYTES);
const OptionalString = new ListCompositeType(StringBytes, 1);

const TransactionBytes = new ByteListType(MAX_BYTES_PER_TRANSACTION);
const TransactionsList = new ListCompositeType(TransactionBytes, MAX_TRANSACTIONS_PER_PAYLOAD);
const ExecutionRequestBytes = new ByteListType(MAX_BYTES_PER_EXECUTION_REQUEST);
/** Each element is `type_byte || ssz_bytes`; the CL forwards them opaquely. */
const ExecutionRequestsList = new ListCompositeType(ExecutionRequestBytes, MAX_EXECUTION_REQUESTS_PER_PAYLOAD);
const BlockAccessListBytes = new ByteListType(MAX_BAL_BYTES);
const VersionedHashesList = new ListCompositeType(Bytes32, MAX_BLOBS_REQUEST);
const CustodyColumnsBitvector = new BitVectorType(CELLS_PER_EXT_BLOB);
const OptionalCustodyColumns = new ListCompositeType(CustodyColumnsBitvector, 1);
const BlobBytes = new ByteVectorType(BYTES_PER_BLOB);

// ---------------------------------------------------------------------------
// Fork-invariant containers — refactor-ssz.md § Shared structures
// ---------------------------------------------------------------------------

const PayloadStatus = new ContainerType(
  {status: Uint8, latestValidHash: OptionalBytes32, validationError: OptionalString},
  {typeName: "PayloadStatus"}
);

const ForkchoiceState = new ContainerType(
  {headBlockHash: Bytes32, safeBlockHash: Bytes32, finalizedBlockHash: Bytes32},
  {typeName: "ForkchoiceState"}
);

const ForkchoiceUpdateResponse = new ContainerType(
  {payloadStatus: PayloadStatus, payloadId: OptionalBytes8},
  {typeName: "ForkchoiceUpdateResponse"}
);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const textDecoder = new TextDecoder();

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

function toDecodedPayloadStatus(parsed: {
  status: number;
  latestValidHash: Uint8Array[];
  validationError: Uint8Array[];
}): DecodedPayloadStatus {
  return {
    status: statusByteToEnum(parsed.status),
    latestValidHash: parsed.latestValidHash.length === 1 ? toHex(parsed.latestValidHash[0]) : null,
    validationError: parsed.validationError.length === 1 ? textDecoder.decode(parsed.validationError[0]) : null,
  };
}

/**
 * Mirrors get_execution_requests_list: one `type_byte || ssz_bytes` element per non-empty
 * request list, ascending by type. Gloas adds builder deposits (0x03) and exits (0x04).
 */
function buildExecutionRequestsList(fork: ForkName, executionRequests: ExecutionRequests): Uint8Array[] {
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
  if (ForkSeq[fork] >= ForkSeq.gloas) {
    const {builderDeposits, builderExits} = executionRequests as gloas.ExecutionRequests;
    if (builderDeposits.length > 0) {
      items.push(prefix(BUILDER_DEPOSIT_REQUEST_TYPE, ssz.gloas.BuilderDepositRequests.serialize(builderDeposits)));
    }
    if (builderExits.length > 0) {
      items.push(prefix(BUILDER_EXIT_REQUEST_TYPE, ssz.gloas.BuilderExitRequests.serialize(builderExits)));
    }
  }
  return items;
}

function parseExecutionRequestsList(fork: ForkName, items: Uint8Array[]): ExecutionRequests {
  const isGloas = ForkSeq[fork] >= ForkSeq.gloas;
  const result: ExecutionRequests = isGloas
    ? {deposits: [], withdrawals: [], consolidations: [], builderDeposits: [], builderExits: []}
    : {deposits: [], withdrawals: [], consolidations: []};
  // Same canonical-form checks as the JSON-RPC decoder in types.ts: EIP-7685 requires
  // strictly increasing type bytes and forbids empty request groups. Accepting either
  // would let a malformed EL response produce a different request set — and therefore a
  // wrong executionRequestsRoot — on a block we propose.
  let prevRequestType: number | undefined;
  for (const item of items) {
    if (item.length === 0) throw Error("Execution request with empty data");
    const type = item[0];
    const body = item.subarray(1);
    if (body.length === 0) {
      throw Error(`Request with empty data must be excluded from execution requests currentRequestType=${type}`);
    }
    if (prevRequestType !== undefined && prevRequestType >= type) {
      throw Error(
        `Current request type must be larger than previous request type prevRequestType=${prevRequestType} currentRequestType=${type}`
      );
    }
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
      case BUILDER_DEPOSIT_REQUEST_TYPE:
        if (!isGloas) throw Error(`Builder deposit request is not supported pre-gloas fork=${fork}`);
        (result as gloas.ExecutionRequests).builderDeposits = ssz.gloas.BuilderDepositRequests.deserialize(body);
        break;
      case BUILDER_EXIT_REQUEST_TYPE:
        if (!isGloas) throw Error(`Builder exit request is not supported pre-gloas fork=${fork}`);
        (result as gloas.ExecutionRequests).builderExits = ssz.gloas.BuilderExitRequests.deserialize(body);
        break;
      default:
        throw Error(`Unknown execution request type=${type}`);
    }
    prevRequestType = type;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public: PayloadStatus / ForkchoiceUpdateResponse
// ---------------------------------------------------------------------------

export interface DecodedPayloadStatus {
  status: ExecutionPayloadStatus;
  latestValidHash: RootHex | null;
  validationError: string | null;
}

export function decodePayloadStatus(data: Uint8Array): DecodedPayloadStatus {
  return toDecodedPayloadStatus(PayloadStatus.deserialize(data));
}

export interface DecodedForkchoiceUpdateResponse {
  payloadStatus: DecodedPayloadStatus;
  payloadId: PayloadId | null;
}

export function decodeForkchoiceUpdateResponse(data: Uint8Array): DecodedForkchoiceUpdateResponse {
  const parsed = ForkchoiceUpdateResponse.deserialize(data);
  return {
    payloadStatus: toDecodedPayloadStatus(parsed.payloadStatus),
    payloadId: parsed.payloadId.length === 1 ? toHex(parsed.payloadId[0]) : null,
  };
}

// ---------------------------------------------------------------------------
// Per-fork catalogue — refactor-ssz.md § Per-fork container catalogue
// ---------------------------------------------------------------------------

/** Spec ExecutionPayload{Fork} ≡ consensus ExecutionPayload of the matching CL fork. */
const EXECUTION_PAYLOAD_BY_EL_FORK = {
  paris: ssz.bellatrix.ExecutionPayload,
  shanghai: ssz.capella.ExecutionPayload,
  cancun: ssz.deneb.ExecutionPayload,
  prague: ssz.deneb.ExecutionPayload,
  osaka: ssz.deneb.ExecutionPayload,
  amsterdam: ssz.gloas.ExecutionPayload,
} as const;

function envelopeType(elFork: ElForkName) {
  const payload = EXECUTION_PAYLOAD_BY_EL_FORK[elFork];
  switch (elFork) {
    case "paris":
    case "shanghai":
      return new ContainerType({payload}, {typeName: `ExecutionPayloadEnvelope_${elFork}`});
    case "cancun":
      return new ContainerType(
        {payload, parentBeaconBlockRoot: Bytes32},
        {typeName: `ExecutionPayloadEnvelope_${elFork}`}
      );
    default:
      return new ContainerType(
        {payload, parentBeaconBlockRoot: Bytes32, executionRequests: ExecutionRequestsList},
        {typeName: `ExecutionPayloadEnvelope_${elFork}`}
      );
  }
}

const ExecutionPayloadEnvelope = Object.fromEntries(EL_FORK_NAMES.map((f) => [f, envelopeType(f)])) as Record<
  ElForkName,
  ReturnType<typeof envelopeType>
>;

// ---------------------------------------------------------------------------
// Public: POST /payloads
// ---------------------------------------------------------------------------

export function encodeNewPayload(
  fork: ForkName,
  executionPayload: ExecutionPayload,
  parentBeaconBlockRoot?: Uint8Array,
  executionRequests?: ExecutionRequests
): Uint8Array {
  const elFork = clForkToElFork(fork);
  const type = ExecutionPayloadEnvelope[elFork];

  if (elFork === "paris" || elFork === "shanghai") {
    return type.serialize({payload: executionPayload} as never);
  }
  if (parentBeaconBlockRoot === undefined) {
    throw Error(`parentBeaconBlockRoot required in newPayload for fork=${fork}`);
  }
  if (elFork === "cancun") {
    return type.serialize({payload: executionPayload, parentBeaconBlockRoot} as never);
  }
  if (executionRequests === undefined) {
    throw Error(`executionRequests required in newPayload for fork=${fork}`);
  }
  return type.serialize({
    payload: executionPayload,
    parentBeaconBlockRoot,
    executionRequests: buildExecutionRequestsList(fork, executionRequests),
  } as never);
}

// ---------------------------------------------------------------------------
// PayloadAttributes{Fork} — cannot reuse ssz.{fork}.PayloadAttributes from
// @lodestar/types: those declare `suggestedFeeRecipient: stringType` (JSON only).
// ---------------------------------------------------------------------------

const PayloadAttributesParis = new ContainerType(
  {timestamp: ssz.UintNum64, prevRandao: Bytes32, suggestedFeeRecipient: Bytes20},
  {typeName: "PayloadAttributes_paris"}
);
const PayloadAttributesShanghai = new ContainerType(
  {...PayloadAttributesParis.fields, withdrawals: ssz.capella.Withdrawals},
  {typeName: "PayloadAttributes_shanghai"}
);
const PayloadAttributesCancun = new ContainerType(
  {...PayloadAttributesShanghai.fields, parentBeaconBlockRoot: Bytes32},
  {typeName: "PayloadAttributes_cancun"}
);
const PayloadAttributesAmsterdam = new ContainerType(
  {...PayloadAttributesCancun.fields, slotNumber: ssz.UintNum64, targetGasLimit: ssz.UintBn64},
  {typeName: "PayloadAttributes_amsterdam"}
);

const PAYLOAD_ATTRIBUTES_BY_EL_FORK = {
  paris: PayloadAttributesParis,
  shanghai: PayloadAttributesShanghai,
  cancun: PayloadAttributesCancun,
  prague: PayloadAttributesCancun,
  osaka: PayloadAttributesCancun,
  amsterdam: PayloadAttributesAmsterdam,
} as const;

function forkchoiceUpdateType(elFork: ElForkName) {
  const payloadAttributes = new ListCompositeType(PAYLOAD_ATTRIBUTES_BY_EL_FORK[elFork], 1);
  if (elFork === "amsterdam") {
    return new ContainerType(
      {forkchoiceState: ForkchoiceState, payloadAttributes, custodyColumns: OptionalCustodyColumns},
      {typeName: "ForkchoiceUpdate_amsterdam"}
    );
  }
  return new ContainerType(
    {forkchoiceState: ForkchoiceState, payloadAttributes},
    {typeName: `ForkchoiceUpdate_${elFork}`}
  );
}

const ForkchoiceUpdate = Object.fromEntries(EL_FORK_NAMES.map((f) => [f, forkchoiceUpdateType(f)])) as Record<
  ElForkName,
  ReturnType<typeof forkchoiceUpdateType>
>;

function buildPayloadAttributesValue(
  fork: ForkName,
  elFork: ElForkName,
  attrs: PayloadAttributes
): Record<string, unknown> {
  const base = {
    timestamp: attrs.timestamp,
    prevRandao: attrs.prevRandao,
    suggestedFeeRecipient: fromHex(attrs.suggestedFeeRecipient),
  };
  if (elFork === "paris") return base;
  const shanghai = {...base, withdrawals: attrs.withdrawals ?? []};
  if (elFork === "shanghai") return shanghai;
  if (attrs.parentBeaconBlockRoot === undefined) {
    throw Error(`parentBeaconBlockRoot required in PayloadAttributes for fork=${fork}`);
  }
  const cancun = {...shanghai, parentBeaconBlockRoot: attrs.parentBeaconBlockRoot};
  if (elFork !== "amsterdam") return cancun;
  if (attrs.slotNumber === undefined) {
    throw Error(`slotNumber required in PayloadAttributes for fork=${fork}`);
  }
  if (attrs.targetGasLimit === undefined) {
    throw Error(`targetGasLimit required in PayloadAttributes for fork=${fork}`);
  }
  return {...cancun, slotNumber: attrs.slotNumber, targetGasLimit: attrs.targetGasLimit};
}

// ---------------------------------------------------------------------------
// Public: POST /forkchoice
// ---------------------------------------------------------------------------

export function encodeForkchoiceUpdate(
  fork: ForkName,
  headBlockHash: Uint8Array,
  safeBlockHash: Uint8Array,
  finalizedBlockHash: Uint8Array,
  attributes?: PayloadAttributes
): Uint8Array {
  const elFork = clForkToElFork(fork);
  const value: Record<string, unknown> = {
    forkchoiceState: {headBlockHash, safeBlockHash, finalizedBlockHash},
    payloadAttributes: attributes ? [buildPayloadAttributesValue(fork, elFork, attributes)] : [],
  };
  if (elFork === "amsterdam") {
    // custody_columns is out of scope for this transport (needs IExecutionEngine changes);
    // encode as absent so the wire shape matches ForkchoiceUpdateAmsterdam.
    value.custodyColumns = [];
  }
  return ForkchoiceUpdate[elFork].serialize(value as never);
}

// ---------------------------------------------------------------------------
// BuiltPayload{Fork} — refactor-ssz.md § BuiltPayload per fork.
// Field order is normative: execution_requests precedes should_override_builder.
// ---------------------------------------------------------------------------

function builtPayloadType(elFork: ElForkName) {
  const payload = EXECUTION_PAYLOAD_BY_EL_FORK[elFork];
  const name = `BuiltPayload_${elFork}`;
  switch (elFork) {
    case "paris":
    case "shanghai":
      return new ContainerType({payload, blockValue: ssz.UintBn256}, {typeName: name});
    case "cancun":
      return new ContainerType(
        {payload, blockValue: ssz.UintBn256, blobsBundle: ssz.deneb.BlobsBundle, shouldOverrideBuilder: Boolean},
        {typeName: name}
      );
    case "prague":
      return new ContainerType(
        {
          payload,
          blockValue: ssz.UintBn256,
          blobsBundle: ssz.deneb.BlobsBundle,
          executionRequests: ExecutionRequestsList,
          shouldOverrideBuilder: Boolean,
        },
        {typeName: name}
      );
    default:
      return new ContainerType(
        {
          payload,
          blockValue: ssz.UintBn256,
          blobsBundle: ssz.fulu.BlobsBundle,
          executionRequests: ExecutionRequestsList,
          shouldOverrideBuilder: Boolean,
        },
        {typeName: name}
      );
  }
}

const BuiltPayload = Object.fromEntries(EL_FORK_NAMES.map((f) => [f, builtPayloadType(f)])) as Record<
  ElForkName,
  ReturnType<typeof builtPayloadType>
>;

// ---------------------------------------------------------------------------
// Public: GET /payloads/{payloadId}
// ---------------------------------------------------------------------------

export interface DecodedBuiltPayload {
  executionPayload: ExecutionPayload;
  blockValue: bigint;
  blobsBundle?: BlobsBundle;
  executionRequests?: ExecutionRequests;
  shouldOverrideBuilder?: boolean;
}

export function decodeBuiltPayload(fork: ForkName, data: Uint8Array): DecodedBuiltPayload {
  const elFork = clForkToElFork(fork);
  const parsed = BuiltPayload[elFork].deserialize(data) as {
    payload: ExecutionPayload;
    blockValue: bigint;
    blobsBundle?: BlobsBundle;
    executionRequests?: Uint8Array[];
    shouldOverrideBuilder?: boolean;
  };
  return {
    executionPayload: parsed.payload,
    blockValue: parsed.blockValue,
    blobsBundle: parsed.blobsBundle,
    executionRequests: parsed.executionRequests
      ? parseExecutionRequestsList(fork, parsed.executionRequests)
      : undefined,
    shouldOverrideBuilder: parsed.shouldOverrideBuilder,
  };
}

// ---------------------------------------------------------------------------
// Bodies — refactor-ssz.md § POST /bodies/hash and GET /bodies
// ---------------------------------------------------------------------------

const BodiesByHashRequest = new ContainerType(
  {blockHashes: new ListCompositeType(Bytes32, MAX_BODIES_REQUEST)},
  {typeName: "BodiesByHashRequest"}
);

function executionPayloadBodyType(elFork: ElForkName) {
  const name = `ExecutionPayloadBody_${elFork}`;
  switch (elFork) {
    case "paris":
      return new ContainerType({transactions: TransactionsList}, {typeName: name});
    case "amsterdam":
      return new ContainerType(
        {transactions: TransactionsList, withdrawals: ssz.capella.Withdrawals, blockAccessList: BlockAccessListBytes},
        {typeName: name}
      );
    default:
      return new ContainerType(
        {transactions: TransactionsList, withdrawals: ssz.capella.Withdrawals},
        {typeName: name}
      );
  }
}

function bodiesResponseType(elFork: ElForkName) {
  const bodyEntry = new ContainerType(
    {available: Boolean, body: executionPayloadBodyType(elFork)},
    {typeName: `BodyEntry_${elFork}`}
  );
  return new ContainerType(
    {entries: new ListCompositeType(bodyEntry, MAX_BODIES_REQUEST)},
    {typeName: `BodiesResponse_${elFork}`}
  );
}

const BodiesResponse = Object.fromEntries(EL_FORK_NAMES.map((f) => [f, bodiesResponseType(f)])) as Record<
  ElForkName,
  ReturnType<typeof bodiesResponseType>
>;

// ---------------------------------------------------------------------------
// Public: bodies
// ---------------------------------------------------------------------------

export function encodeBodiesByHashRequest(blockHashes: Uint8Array[]): Uint8Array {
  return BodiesByHashRequest.serialize({blockHashes});
}

/**
 * `available=false` (pruned, or outside the header fork's era) -> null, matching the
 * JSON-RPC `null` entries. Range responses may be shorter than requested; the array
 * is returned as-is.
 */
export function decodeBodiesResponse(fork: ForkName, data: Uint8Array): (ExecutionPayloadBody | null)[] {
  const elFork = clForkToElFork(fork);
  const parsed = BodiesResponse[elFork].deserialize(data) as {
    entries: {
      available: boolean;
      body: {transactions: Uint8Array[]; withdrawals?: ExecutionPayloadBody["withdrawals"]};
    }[];
  };
  // Amsterdam bodies also carry `block_access_list` on the wire, and it is decoded into
  // `parsed` — but deliberately not surfaced. `ExecutionPayloadBody` is shared with the
  // JSON-RPC transport, whose `ExecutionPayloadBodyRpc` has no equivalent field, so
  // adding one here would give callers a value only this transport can ever populate and
  // no way to tell "the EL sent nothing" from "we are on JSON-RPC". Revisit when a caller
  // needs the BAL; today `getPayloadBodiesByHash/ByRange` have none.
  return parsed.entries.map((e) =>
    e.available ? {transactions: e.body.transactions, withdrawals: e.body.withdrawals ?? null} : null
  );
}

// ---------------------------------------------------------------------------
// Blobs — refactor-ssz.md § POST /blobs/v1, /blobs/v2 (independently versioned)
// ---------------------------------------------------------------------------

const BlobsRequest = new ContainerType({versionedHashes: VersionedHashesList}, {typeName: "BlobsRequest"});

const BlobAndProofV1Ssz = new ContainerType({blob: BlobBytes, proof: Bytes48}, {typeName: "BlobAndProofV1"});
// Named `*Ssz` to avoid colliding with the `BlobAndProofV2` type imported from @lodestar/types/fulu.
const BlobAndProofV2Ssz = new ContainerType(
  {blob: BlobBytes, proofs: new ListCompositeType(Bytes48, CELLS_PER_EXT_BLOB)},
  {typeName: "BlobAndProofV2"}
);
const BlobV1Entry = new ContainerType({available: Boolean, contents: BlobAndProofV1Ssz}, {typeName: "BlobV1Entry"});
const BlobV2Entry = new ContainerType({available: Boolean, contents: BlobAndProofV2Ssz}, {typeName: "BlobV2Entry"});
const BlobsV1Response = new ContainerType(
  {entries: new ListCompositeType(BlobV1Entry, MAX_BLOBS_REQUEST)},
  {typeName: "BlobsV1Response"}
);
const BlobsV2Response = new ContainerType(
  {entries: new ListCompositeType(BlobV2Entry, MAX_BLOBS_REQUEST)},
  {typeName: "BlobsV2Response"}
);

const PROOF_BYTES = 48;

// ---------------------------------------------------------------------------
// Public: blobs
// ---------------------------------------------------------------------------

export function encodeBlobsRequest(versionedHashes: Uint8Array[]): Uint8Array {
  return BlobsRequest.serialize({versionedHashes});
}

/** `/blobs/v1` supports partial responses: `available=false` -> null (JSON-RPC v1 contract). */
export function decodeBlobsV1Response(data: Uint8Array): (BlobAndProof | null)[] {
  return BlobsV1Response.deserialize(data).entries.map((e) =>
    e.available ? {blob: e.contents.blob, proof: e.contents.proof} : null
  );
}

/**
 * `/blobs/v2` is all-or-nothing: a 200 must have every entry available (a miss is
 * signalled by 204, handled by the caller). When `buffers` is given, blob and proofs
 * are copied into `buffers[i]` and the returned views alias it (block-production hot path).
 */
export function decodeBlobsV2Response(data: Uint8Array, buffers?: Uint8Array[]): BlobAndProofV2[] {
  const {entries} = BlobsV2Response.deserialize(data);
  return entries.map((e, i) => {
    if (!e.available) {
      throw Error(`/blobs/v2 entry ${i} has available=false; v2 is all-or-nothing`);
    }
    if (e.contents.proofs.length !== CELLS_PER_EXT_BLOB) {
      throw Error(`Invalid proofs length ${e.contents.proofs.length}, expected ${CELLS_PER_EXT_BLOB}`);
    }
    const buffer = buffers?.[i];
    if (buffer === undefined) {
      return {blob: e.contents.blob, proofs: e.contents.proofs};
    }
    if (buffer.length !== BLOB_AND_PROOF_V2_RPC_BYTES) {
      throw Error(`Invalid buffer[${i}] length=${buffer.length} expected=${BLOB_AND_PROOF_V2_RPC_BYTES}`);
    }
    const blob = buffer.subarray(0, BYTES_PER_BLOB);
    blob.set(e.contents.blob);
    const proofs: Uint8Array[] = [];
    for (let p = 0; p < CELLS_PER_EXT_BLOB; p++) {
      const start = BYTES_PER_BLOB + p * PROOF_BYTES;
      const view = buffer.subarray(start, start + PROOF_BYTES);
      view.set(e.contents.proofs[p]);
      proofs.push(view);
    }
    return {blob, proofs};
  });
}

// ---------------------------------------------------------------------------
// JSON diagnostics — refactor.md § Capabilities & identification
// ---------------------------------------------------------------------------

export interface RestCapabilities {
  supportedForks: Set<ElForkName>;
  blobRevisions: Set<number>;
  limits: {bodiesMaxCount: number; blobsMaxVersionedHashes: number; payloadMaxBytes: number};
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function limitOrDefault(limits: Record<string, unknown> | undefined, key: string, max: number): number {
  const v = limits?.[key];
  // Advertised values are an upper bound the server will serve; they MUST NOT exceed MAX_*.
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? Math.min(v, max) : max;
}

export function parseCapabilities(json: unknown): RestCapabilities {
  if (!isRecord(json)) throw Error("capabilities: expected a JSON object");
  const forks = json.supported_forks;
  if (!Array.isArray(forks)) throw Error("capabilities: missing supported_forks");

  const supportedForks = new Set<ElForkName>();
  for (const f of forks) {
    if (typeof f === "string" && (EL_FORK_NAMES as readonly string[]).includes(f)) {
      supportedForks.add(f as ElForkName);
    }
  }

  const blobRevisions = new Set<number>();
  const versioned = isRecord(json.independently_versioned) ? json.independently_versioned : undefined;
  if (Array.isArray(versioned?.blobs)) {
    for (const v of versioned.blobs) {
      const m = typeof v === "string" ? /^v(\d+)$/.exec(v) : null;
      if (m) blobRevisions.add(Number(m[1]));
    }
  }

  const limits = isRecord(json.limits) ? json.limits : undefined;
  return {
    supportedForks,
    blobRevisions,
    limits: {
      bodiesMaxCount: limitOrDefault(limits, "bodies.max_count", MAX_BODIES_REQUEST),
      blobsMaxVersionedHashes: limitOrDefault(limits, "blobs.max_versioned_hashes", MAX_BLOBS_REQUEST),
      payloadMaxBytes: limitOrDefault(limits, "payload.max_bytes", MAX_REQUEST_BODY_SIZE),
    },
  };
}

export function parseIdentity(json: unknown): ClientVersionRpc[] {
  if (!Array.isArray(json)) throw Error("identity: expected a JSON array");
  return json.map((v, i) => {
    if (
      !isRecord(v) ||
      typeof v.code !== "string" ||
      typeof v.name !== "string" ||
      typeof v.version !== "string" ||
      typeof v.commit !== "string"
    ) {
      throw Error(`identity: entry ${i} is not a ClientVersion`);
    }
    return {code: v.code, name: v.name, version: v.version, commit: v.commit};
  });
}
