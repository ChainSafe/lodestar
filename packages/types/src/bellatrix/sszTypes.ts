import {ByteListType, ByteVectorType, ContainerType, ListCompositeType} from "@chainsafe/ssz";
import {
  BYTES_PER_LOGS_BLOOM,
  HISTORICAL_ROOTS_LIMIT,
  MAX_TRANSACTIONS_PER_PAYLOAD,
  MAX_BYTES_PER_TRANSACTION,
  MAX_EXTRA_DATA_BYTES,
} from "@lodestar/params";
import {ssz as primitiveSsz} from "../primitive/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as altairSsz} from "../altair/index.js";

const {
  Bytes32,
  UintNum64,
  Slot,
  ValidatorIndex,
  Root,
  BLSSignature,
  UintBn256: Uint256,
  BLSPubkey,
  ExecutionAddress,
} = primitiveSsz;

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
export const Transactions = ListCompositeType.named(Transaction, MAX_TRANSACTIONS_PER_PAYLOAD, {
  typeName: "Transactions",
});

export const CommonExecutionPayloadType = ContainerType.named(
  {
    parentHash: Root,
    feeRecipient: ExecutionAddress,
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
  },
  {typeName: "CommonExecutionPayloadType", jsonCase: "eth2"}
);

const executionPayloadFields = {
  ...CommonExecutionPayloadType.fields,
  // Extra payload fields
  blockHash: Root,
};

export const ExecutionPayload = ContainerType.named(
  {
    ...executionPayloadFields,
    transactions: Transactions,
  },
  {typeName: "ExecutionPayloadBellatrix", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = ContainerType.named(
  {
    ...executionPayloadFields,
    transactionsRoot: Root,
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

export const BeaconBlockBody = ContainerType.named(
  {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayload: ExecutionPayload,
  },
  {typeName: "BeaconBlockBodyBellatrix", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = ContainerType.named(
  {
    slot: Slot,
    proposerIndex: ValidatorIndex,
    // Reclare expandedType() with altair block and altair state
    parentRoot: Root,
    stateRoot: Root,
    body: BeaconBlockBody,
  },
  {typeName: "BeaconBlockBellatrix", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = ContainerType.named(
  {
    message: BeaconBlock,
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlockBellatrix", jsonCase: "eth2"}
);

export const PowBlock = ContainerType.named(
  {
    blockHash: Root,
    parentHash: Root,
    totalDifficulty: Uint256,
  },
  {typeName: "PowBlock", jsonCase: "eth2"}
);

// we don't reuse phase0.BeaconState fields since we need to replace some keys
// and we cannot keep order doing that
export const BeaconState = ContainerType.named(
  {
    genesisTime: UintNum64,
    genesisValidatorsRoot: Root,
    slot: primitiveSsz.Slot,
    fork: phase0Ssz.Fork,
    // History
    latestBlockHeader: phase0Ssz.BeaconBlockHeader,
    blockRoots: phase0Ssz.HistoricalBlockRoots,
    stateRoots: phase0Ssz.HistoricalStateRoots,
    historicalRoots: ListCompositeType.named(Root, HISTORICAL_ROOTS_LIMIT, {typeName: "HistoricalRoots"}),
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
  {typeName: "BeaconStateBellatrix", jsonCase: "eth2"}
);

export const BlindedBeaconBlockBody = ContainerType.named(
  {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayloadHeader: ExecutionPayloadHeader,
  },
  {typeName: "BlindedBeaconBlockBodyBellatrix", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BlindedBeaconBlock = ContainerType.named(
  {
    slot: Slot,
    proposerIndex: ValidatorIndex,
    // Reclare expandedType() with altair block and altair state
    parentRoot: Root,
    stateRoot: Root,
    body: BlindedBeaconBlockBody,
  },
  {typeName: "BlindedBeaconBlockBellatrix", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBlindedBeaconBlock = ContainerType.named(
  {
    message: BlindedBeaconBlock,
    signature: BLSSignature,
  },
  {typeName: "SignedBlindedBeaconBlockBellatrix", jsonCase: "eth2"}
);

export const ValidatorRegistrationV1 = ContainerType.named(
  {
    feeRecipient: ExecutionAddress,
    gasLimit: UintNum64,
    timestamp: UintNum64,
    pubkey: BLSPubkey,
  },
  {typeName: "ValidatorRegistrationV1", jsonCase: "eth2"}
);

export const SignedValidatorRegistrationV1 = ContainerType.named(
  {
    message: ValidatorRegistrationV1,
    signature: BLSSignature,
  },
  {typeName: "SignedValidatorRegistrationV1", jsonCase: "eth2"}
);

export const BuilderBid = ContainerType.named(
  {
    header: ExecutionPayloadHeader,
    value: Uint256,
    pubkey: BLSPubkey,
  },
  {typeName: "BuilderBid", jsonCase: "eth2"}
);

export const SignedBuilderBid = ContainerType.named(
  {
    message: BuilderBid,
    signature: BLSSignature,
  },
  {typeName: "SignedBuilderBid", jsonCase: "eth2"}
);

// PayloadAttributes primarily for SSE event
export const PayloadAttributes = ContainerType.named(
  {timestamp: UintNum64, prevRandao: Bytes32, suggestedFeeRecipient: ExecutionAddress},
  {typeName: "PayloadAttributes", jsonCase: "eth2"}
);

export const SSEPayloadAttributesCommon = ContainerType.named(
  {
    proposerIndex: UintNum64,
    proposalSlot: Slot,
    proposalBlockNumber: UintNum64,
    parentBlockRoot: Root,
    parentBlockHash: Root,
  },
  {typeName: "SSEPayloadAttributesCommon", jsonCase: "eth2"}
);

export const SSEPayloadAttributes = ContainerType.named(
  {
    ...SSEPayloadAttributesCommon.fields,
    payloadAttributes: PayloadAttributes,
  },
  {typeName: "SSEPayloadAttributes", jsonCase: "eth2"}
);
