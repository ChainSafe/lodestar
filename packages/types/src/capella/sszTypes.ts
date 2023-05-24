import {ContainerType, ListCompositeType, VectorCompositeType} from "@chainsafe/ssz";
import {
  HISTORICAL_ROOTS_LIMIT,
  MAX_WITHDRAWALS_PER_PAYLOAD,
  MAX_BLS_TO_EXECUTION_CHANGES,
  BLOCK_BODY_EXECUTION_PAYLOAD_DEPTH as EXECUTION_PAYLOAD_DEPTH,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {ssz as primitiveSsz} from "../primitive/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as bellatrixSsz} from "../bellatrix/index.js";

const {
  UintNum64,
  Slot,
  ValidatorIndex,
  WithdrawalIndex,
  Root,
  BLSSignature,
  BLSPubkey,
  ExecutionAddress,
  Gwei,
  UintBn256,
  Bytes32,
} = primitiveSsz;

export const Withdrawal = ContainerType.named(
  {
    index: WithdrawalIndex,
    validatorIndex: ValidatorIndex,
    address: ExecutionAddress,
    amount: Gwei,
  },
  {typeName: "Withdrawal", jsonCase: "eth2"}
);

export const BLSToExecutionChange = ContainerType.named(
  {
    validatorIndex: ValidatorIndex,
    fromBlsPubkey: BLSPubkey,
    toExecutionAddress: ExecutionAddress,
  },
  {typeName: "BLSToExecutionChange", jsonCase: "eth2"}
);

export const SignedBLSToExecutionChange = ContainerType.named(
  {
    message: BLSToExecutionChange,
    signature: BLSSignature,
  },
  {typeName: "SignedBLSToExecutionChange", jsonCase: "eth2"}
);

export const Withdrawals = ListCompositeType.named(Withdrawal, MAX_WITHDRAWALS_PER_PAYLOAD, {typeName: "Withdrawals"});
export const ExecutionPayload = ContainerType.named(
  {
    ...bellatrixSsz.ExecutionPayload.fields,
    withdrawals: Withdrawals, // New in capella
  },
  {typeName: "ExecutionPayloadCapella", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = ContainerType.named(
  {
    ...bellatrixSsz.ExecutionPayloadHeader.fields,
    withdrawalsRoot: Root, // New in capella
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

export const BLSToExecutionChanges = ListCompositeType.named(SignedBLSToExecutionChange, MAX_BLS_TO_EXECUTION_CHANGES, {
  typeName: "BLSToExecutionChanges",
});
export const BeaconBlockBody = ContainerType.named(
  {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayload: ExecutionPayload, // Modified in capella
    blsToExecutionChanges: BLSToExecutionChanges,
  },
  {typeName: "BeaconBlockBodyCapella", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = ContainerType.named(
  {
    slot: Slot,
    proposerIndex: ValidatorIndex,
    // Reclare expandedType() with altair block and altair state
    parentRoot: Root,
    stateRoot: Root,
    body: BeaconBlockBody, // Modified in Capella
  },
  {typeName: "BeaconBlockCapella", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = ContainerType.named(
  {
    message: BeaconBlock, // Modified in capella
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlockCapella", jsonCase: "eth2"}
);

export const BuilderBid = ContainerType.named(
  {
    header: ExecutionPayloadHeader,
    value: UintBn256,
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

export const HistoricalSummary = ContainerType.named(
  {
    blockSummaryRoot: Root,
    stateSummaryRoot: Root,
  },
  {typeName: "HistoricalSummary", jsonCase: "eth2"}
);

// we don't reuse bellatrix.BeaconState fields since we need to replace some keys
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
    // historical_roots Frozen in Capella, replaced by historical_summaries
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
    latestExecutionPayloadHeader: ExecutionPayloadHeader, // [Modified in Capella]
    // Withdrawals
    nextWithdrawalIndex: WithdrawalIndex, // [New in Capella]
    nextWithdrawalValidatorIndex: ValidatorIndex, // [New in Capella]
    // Deep history valid from Capella onwards
    historicalSummaries: ListCompositeType.named(HistoricalSummary, HISTORICAL_ROOTS_LIMIT, {
      typeName: "HistoricalSummaries",
    }), // [New in Capella]
  },
  {typeName: "BeaconStateCapella", jsonCase: "eth2"}
);

export const BlindedBeaconBlockBody = ContainerType.named(
  {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayloadHeader: ExecutionPayloadHeader, // Modified in capella
    blsToExecutionChanges: BLSToExecutionChanges, // New in capella
  },
  {typeName: "BlindedBeaconBlockBodyCapella", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BlindedBeaconBlock = ContainerType.named(
  {
    slot: Slot,
    proposerIndex: ValidatorIndex,
    // Reclare expandedType() with altair block and altair state
    parentRoot: Root,
    stateRoot: Root,
    body: BlindedBeaconBlockBody, // Modified in capella
  },
  {typeName: "BlindedBeaconBlockCapella", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBlindedBeaconBlock = ContainerType.named(
  {
    message: BlindedBeaconBlock, // Modified in capella
    signature: BLSSignature,
  },
  {typeName: "SignedBlindedBeaconBlockCapella", jsonCase: "eth2"}
);

export const LightClientHeader = ContainerType.named(
  {
    beacon: phase0Ssz.BeaconBlockHeader,
    execution: ExecutionPayloadHeader,
    executionBranch: VectorCompositeType.named(Bytes32, EXECUTION_PAYLOAD_DEPTH, {typeName: "ExecutionBranch"}),
  },
  {typeName: "LightClientHeaderCapella", jsonCase: "eth2"}
);

export const LightClientBootstrap = ContainerType.named(
  {
    header: LightClientHeader,
    currentSyncCommittee: altairSsz.SyncCommittee,
    currentSyncCommitteeBranch: altairSsz.LightClientBootstrap.fields.currentSyncCommitteeBranch,
  },
  {typeName: "LightClientBootstrapCapella", jsonCase: "eth2"}
);

export const LightClientUpdate = ContainerType.named(
  {
    attestedHeader: LightClientHeader,
    nextSyncCommittee: altairSsz.SyncCommittee,
    nextSyncCommitteeBranch: altairSsz.LightClientUpdate.fields.nextSyncCommitteeBranch,
    finalizedHeader: LightClientHeader,
    finalityBranch: altairSsz.LightClientUpdate.fields.finalityBranch,
    syncAggregate: altairSsz.SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientUpdateCapella", jsonCase: "eth2"}
);

export const LightClientFinalityUpdate = ContainerType.named(
  {
    attestedHeader: LightClientHeader,
    finalizedHeader: LightClientHeader,
    finalityBranch: altairSsz.LightClientFinalityUpdate.fields.finalityBranch,
    syncAggregate: altairSsz.SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientFinalityUpdateCapella", jsonCase: "eth2"}
);

export const LightClientOptimisticUpdate = ContainerType.named(
  {
    attestedHeader: LightClientHeader,
    syncAggregate: altairSsz.SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientOptimisticUpdateCapella", jsonCase: "eth2"}
);

export const LightClientStore = ContainerType.named(
  {
    snapshot: LightClientBootstrap,
    validUpdates: ListCompositeType.named(LightClientUpdate, EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH, {
      typeName: "ValidUpdates",
    }),
  },
  {typeName: "LightClientStore", jsonCase: "eth2"}
);

// PayloadAttributes primarily for SSE event
export const PayloadAttributes = ContainerType.named(
  {
    ...bellatrixSsz.PayloadAttributes.fields,
    withdrawals: Withdrawals,
  },
  {typeName: "PayloadAttributes", jsonCase: "eth2"}
);

export const SSEPayloadAttributes = ContainerType.named(
  {
    ...bellatrixSsz.SSEPayloadAttributesCommon.fields,
    payloadAttributes: PayloadAttributes,
  },
  {typeName: "SSEPayloadAttributes", jsonCase: "eth2"}
);
