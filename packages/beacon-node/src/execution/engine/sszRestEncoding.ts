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
  CELLS_PER_EXT_BLOB,
  CONSOLIDATION_REQUEST_TYPE,
  DEPOSIT_REQUEST_TYPE,
  ForkName,
  MAX_BLOB_COMMITMENTS_PER_BLOCK,
  MAX_BYTES_PER_TRANSACTION,
  MAX_TRANSACTIONS_PER_PAYLOAD,
  WITHDRAWAL_REQUEST_TYPE,
} from "@lodestar/params";
import {BlobsBundle, ExecutionPayload, ExecutionRequests, RootHex, ssz} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {ExecutionPayloadStatus, PayloadAttributes} from "./interface.js";
import {PayloadId} from "./payloadIdCache.js";

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
export const EXECUTION_PAYLOAD_BY_EL_FORK = {
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
    executionRequests: buildExecutionRequestsList(executionRequests),
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
  {...PayloadAttributesCancun.fields, slotNumber: ssz.UintNum64, targetGasLimit: ssz.UintNum64},
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
    executionRequests: parsed.executionRequests ? parseExecutionRequestsList(parsed.executionRequests) : undefined,
    shouldOverrideBuilder: parsed.shouldOverrideBuilder,
  };
}
