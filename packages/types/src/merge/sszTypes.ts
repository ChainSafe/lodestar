import {
  byteType,
  ByteVectorType,
  ContainerType,
  List,
  ListType,
  RootType,
  Union,
  UnionType,
  Vector,
  VectorType,
} from "@chainsafe/ssz";
import {
  BYTES_PER_LOGS_BLOOM,
  HISTORICAL_ROOTS_LIMIT,
  MAX_TRANSACTIONS_PER_PAYLOAD,
  MAX_BYTES_PER_OPAQUE_TRANSACTION,
  MAX_EXTRA_DATA_BYTES,
  SLOTS_PER_HISTORICAL_ROOT,
} from "@chainsafe/lodestar-params";
import {ssz as primitiveSsz, ts as primitive} from "../primitive";
import {ssz as phase0Ssz, ts as phase0} from "../phase0";
import {ssz as altairSsz} from "../altair";
import * as merge from "./types";
import {LazyVariable} from "../utils/lazyVar";
import {Uint256} from "../primitive/sszTypes";

const {Bytes20, Bytes32, Number64, Slot, ValidatorIndex, Root, BLSSignature, Uint8} = primitiveSsz;

// So the expandedRoots can be referenced, and break the circular dependency
const typesRef = new LazyVariable<{
  BeaconBlock: ContainerType<merge.BeaconBlock>;
  BeaconState: ContainerType<merge.BeaconState>;
}>();

/**
 * ByteList[MAX_BYTES_PER_OPAQUE_TRANSACTION]
 *
 * Spec v1.0.1
 */
export const OpaqueTransaction = new ListType({elementType: byteType, limit: MAX_BYTES_PER_OPAQUE_TRANSACTION});

/**
 * Union[OpaqueTransaction]
 *
 * Spec v1.0.1
 */
export const Transaction = new UnionType<Union<merge.Transaction>>({types: [OpaqueTransaction]});
export const Transactions = new ListType<List<merge.Transaction>>({
  elementType: Transaction,
  limit: MAX_TRANSACTIONS_PER_PAYLOAD,
});

const executionPayloadFields = {
  parentHash: Root,
  coinbase: Bytes20,
  stateRoot: Bytes32,
  receiptRoot: Bytes32,
  logsBloom: new ByteVectorType({length: BYTES_PER_LOGS_BLOOM}),
  random: Bytes32,
  blockNumber: Number64,
  gasLimit: Number64,
  gasUsed: Number64,
  timestamp: Number64,
  // TODO: if there is perf issue, consider making ByteListType
  extraData: new ListType({limit: MAX_EXTRA_DATA_BYTES, elementType: Uint8}),
  baseFeePerGas: Uint256,
  // Extra payload fields
  blockHash: Root,
};
const executionPayloadCasingMap = {
  parentHash: "parent_hash",
  coinbase: "coinbase",
  stateRoot: "state_root",
  receiptRoot: "receipt_root",
  logsBloom: "logs_bloom",
  random: "random",
  blockNumber: "block_number",
  gasLimit: "gas_limit",
  gasUsed: "gas_used",
  timestamp: "timestamp",
  extraData: "extra_data",
  baseFeePerGas: "base_fee_per_gas",
  blockHash: "block_hash",
};

/**
 * ```python
 * class ExecutionPayload(Container):
 *     # Execution block header fields
 *     parent_hash: Hash32
 *     coinbase: Bytes20  # 'beneficiary' in the yellow paper
 *     state_root: Bytes32
 *     receipt_root: Bytes32  # 'receipts root' in the yellow paper
 *     logs_bloom: ByteVector[BYTES_PER_LOGS_BLOOM]
 *     random: Bytes32  # 'difficulty' in the yellow paper
 *     block_number: uint64  # 'number' in the yellow paper
 *     gas_limit: uint64
 *     gas_used: uint64
 *     timestamp: uint64
 *     extra_data: ByteList[MAX_EXTRA_DATA_BYTES]
 *     base_fee_per_gas: Bytes32  # base fee introduced in EIP-1559, little-endian serialized
 *     # Extra payload fields
 *     block_hash: Hash32  # Hash of execution block
 *     transactions: List[Transaction, MAX_TRANSACTIONS_PER_PAYLOAD]
 * ```
 *
 * Spec v1.0.1
 */
export const ExecutionPayload = new ContainerType<merge.ExecutionPayload>({
  fields: {
    ...executionPayloadFields,
    transactions: Transactions,
  },
  casingMap: {
    ...executionPayloadCasingMap,
    transactions: "transactions",
  },
});

/**
 * ```python
 * class ExecutionPayload(Container):
 *     ...
 *     transactions_root: Root
 * ```
 *
 * Spec v1.0.1
 */
export const ExecutionPayloadHeader = new ContainerType<merge.ExecutionPayloadHeader>({
  fields: {
    ...executionPayloadFields,
    transactionsRoot: Root,
  },
  casingMap: {
    ...executionPayloadCasingMap,
    transactionsRoot: "transactions_root",
  },
});

export const BeaconBlockBody = new ContainerType<merge.BeaconBlockBody>({
  fields: {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayload: ExecutionPayload,
  },
  casingMap: {
    ...altairSsz.BeaconBlockBody.casingMap,
    executionPayload: "execution_payload",
  },
});

export const BeaconBlock = new ContainerType<merge.BeaconBlock>({
  fields: {
    slot: Slot,
    proposerIndex: ValidatorIndex,
    // Reclare expandedType() with altair block and altair state
    parentRoot: new RootType({expandedType: () => typesRef.get().BeaconBlock}),
    stateRoot: new RootType({expandedType: () => typesRef.get().BeaconState}),
    body: BeaconBlockBody,
  },
  casingMap: altairSsz.BeaconBlock.casingMap,
});

export const SignedBeaconBlock = new ContainerType<merge.SignedBeaconBlock>({
  fields: {
    message: BeaconBlock,
    signature: BLSSignature,
  },
  expectedCase: "notransform",
});

export const PowBlock = new ContainerType<merge.PowBlock>({
  fields: {
    blockHash: Root,
    parentHash: Root,
    totalDifficulty: Uint256,
    difficulty: Uint256,
  },
  casingMap: {
    blockHash: "block_hash",
    parentHash: "parent_hash",
    totalDifficulty: "total_difficulty",
    difficulty: "difficulty",
  },
});

// Re-declare with the new expanded type
export const HistoricalBlockRoots = new VectorType<Vector<primitive.Root>>({
  elementType: new RootType({expandedType: () => typesRef.get().BeaconBlock}),
  length: SLOTS_PER_HISTORICAL_ROOT,
});

export const HistoricalStateRoots = new VectorType<Vector<primitive.Root>>({
  elementType: new RootType({expandedType: () => typesRef.get().BeaconState}),
  length: SLOTS_PER_HISTORICAL_ROOT,
});

export const HistoricalBatch = new ContainerType<phase0.HistoricalBatch>({
  fields: {
    blockRoots: HistoricalBlockRoots,
    stateRoots: HistoricalStateRoots,
  },
  casingMap: phase0Ssz.HistoricalBatch.casingMap,
});

// we don't reuse phase0.BeaconState fields since we need to replace some keys
// and we cannot keep order doing that
export const BeaconState = new ContainerType<merge.BeaconState>({
  fields: {
    genesisTime: Number64,
    genesisValidatorsRoot: Root,
    slot: primitiveSsz.Slot,
    fork: phase0Ssz.Fork,
    // History
    latestBlockHeader: phase0Ssz.BeaconBlockHeader,
    blockRoots: HistoricalBlockRoots,
    stateRoots: HistoricalStateRoots,
    historicalRoots: new ListType({
      elementType: new RootType({expandedType: HistoricalBatch}),
      limit: HISTORICAL_ROOTS_LIMIT,
    }),
    // Eth1
    eth1Data: phase0Ssz.Eth1Data,
    eth1DataVotes: phase0Ssz.Eth1DataVotes,
    eth1DepositIndex: Number64,
    // Registry
    validators: phase0Ssz.Validators,
    balances: phase0Ssz.Balances,
    randaoMixes: phase0Ssz.RandaoMixes,
    // Slashings
    slashings: phase0Ssz.Slashings,
    // Participation
    previousEpochParticipation: altairSsz.EpochParticipation,
    currentEpochParticipation: altairSsz.EpochParticipation,
    // Finality
    justificationBits: phase0Ssz.JustificationBits,
    previousJustifiedCheckpoint: phase0Ssz.Checkpoint,
    currentJustifiedCheckpoint: phase0Ssz.Checkpoint,
    finalizedCheckpoint: phase0Ssz.Checkpoint,
    // Inactivity
    inactivityScores: altairSsz.InactivityScores,
    // Sync
    currentSyncCommittee: altairSsz.SyncCommittee,
    nextSyncCommittee: altairSsz.SyncCommittee,
    // Execution
    latestExecutionPayloadHeader: ExecutionPayloadHeader, // [New in Merge]
  },
  casingMap: {
    ...altairSsz.BeaconState.casingMap,
    latestExecutionPayloadHeader: "latest_execution_payload_header",
  },
});

// MUST set typesRef here, otherwise expandedType() calls will throw
typesRef.set({BeaconBlock, BeaconState});
