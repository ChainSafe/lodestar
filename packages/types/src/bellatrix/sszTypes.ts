import {ByteListType, ByteVectorType, ContainerType, ListCompositeType, VectorCompositeType} from "@chainsafe/ssz";
import {ssz as primitiveSsz} from "../primitive/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as altairSsz} from "../altair/index.js";
import {
  BYTES_PER_LOGS_BLOOM,
  HISTORICAL_ROOTS_LIMIT,
  MAX_TRANSACTIONS_PER_PAYLOAD,
  MAX_BYTES_PER_TRANSACTION,
  MAX_EXTRA_DATA_BYTES,
  SLOTS_PER_HISTORICAL_ROOT,
} from "@chainsafe/lodestar-params";

const {Bytes20, Bytes32, UintNum64, Slot, ValidatorIndex, Root, BLSSignature, UintBn256: Uint256} = primitiveSsz;

/**
 * ByteList[MAX_BYTES_PER_TRANSACTION]
 *
 * Spec v1.0.1
 */
export const Transaction = new ByteListType(MAX_BYTES_PER_TRANSACTION);

/**
 * Union[OpaqueTransaction]
 *
 * Spec v1.0.1
 */
export const Transactions = new ListCompositeType(Transaction, MAX_TRANSACTIONS_PER_PAYLOAD);

const executionPayloadFields = {
  parentHash: Root,
  feeRecipient: Bytes20,
  stateRoot: Bytes32,
  receiptsRoot: Bytes32,
  logsBloom: new ByteVectorType(BYTES_PER_LOGS_BLOOM),
  prevRandao: Bytes32,
  blockNumber: UintNum64,
  gasLimit: UintNum64,
  gasUsed: UintNum64,
  timestamp: UintNum64,
  // TODO: if there is perf issue, consider making ByteListType
  extraData: new ByteListType(MAX_EXTRA_DATA_BYTES),
  baseFeePerGas: Uint256,
  // Extra payload fields
  blockHash: Root,
};

export const ExecutionPayload = new ContainerType(
  {
    ...executionPayloadFields,
    transactions: Transactions,
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = new ContainerType(
  {
    ...executionPayloadFields,
    transactionsRoot: Root,
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

export const BeaconBlockBody = new ContainerType(
  {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayload: ExecutionPayload,
  },
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    slot: Slot,
    proposerIndex: ValidatorIndex,
    // Reclare expandedType() with altair block and altair state
    parentRoot: Root,
    stateRoot: Root,
    body: BeaconBlockBody,
  },
  {typeName: "BeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = new ContainerType(
  {
    message: BeaconBlock,
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlock", jsonCase: "eth2"}
);

export const PowBlock = new ContainerType(
  {
    blockHash: Root,
    parentHash: Root,
    totalDifficulty: Uint256,
  },
  {typeName: "PowBlock", jsonCase: "eth2"}
);

// Re-declare with the new expanded type
export const HistoricalBlockRoots = new VectorCompositeType(Root, SLOTS_PER_HISTORICAL_ROOT);
export const HistoricalStateRoots = new VectorCompositeType(Root, SLOTS_PER_HISTORICAL_ROOT);

export const HistoricalBatch = new ContainerType(
  {
    blockRoots: HistoricalBlockRoots,
    stateRoots: HistoricalStateRoots,
  },
  {typeName: "HistoricalBatch", jsonCase: "eth2"}
);

// we don't reuse phase0.BeaconState fields since we need to replace some keys
// and we cannot keep order doing that
export const BeaconState = new ContainerType(
  {
    genesisTime: UintNum64,
    genesisValidatorsRoot: Root,
    slot: primitiveSsz.Slot,
    fork: phase0Ssz.Fork,
    // History
    latestBlockHeader: phase0Ssz.BeaconBlockHeader,
    blockRoots: HistoricalBlockRoots,
    stateRoots: HistoricalStateRoots,
    historicalRoots: new ListCompositeType(Root, HISTORICAL_ROOTS_LIMIT),
    // Eth1
    eth1Data: phase0Ssz.Eth1Data,
    eth1DataVotes: phase0Ssz.Eth1DataVotes,
    eth1DepositIndex: UintNum64,
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
  {typeName: "BeaconState", jsonCase: "eth2"}
);
