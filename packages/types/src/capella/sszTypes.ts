import {ContainerType, ListCompositeType, VectorCompositeType, ContainerNodeStructType} from "@chainsafe/ssz";
import {
  HISTORICAL_ROOTS_LIMIT,
  SLOTS_PER_HISTORICAL_ROOT,
  MAX_WITHDRAWALS_PER_PAYLOAD,
  MAX_BLS_TO_EXECUTION_CHANGES,
  WITHDRAWAL_QUEUE_LIMIT,
  VALIDATOR_REGISTRY_LIMIT,
} from "@lodestar/params";
import {ssz as primitiveSsz} from "../primitive/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as bellatrixSsz} from "../bellatrix/index.js";

const {
  UintNum64,
  Slot,
  EpochInf,
  ValidatorIndex,
  WithdrawalIndex,
  Root,
  BLSSignature,
  BLSPubkey,
  ExecutionAddress,
  Gwei,
} = primitiveSsz;

export const Withdrawal = new ContainerType(
  {
    index: WithdrawalIndex,
    address: ExecutionAddress,
    amount: Gwei,
  },
  {typeName: "Withdrawal", jsonCase: "eth2"}
);

export const BLSToExecutionChange = new ContainerType(
  {
    validatorIndex: ValidatorIndex,
    fromBlsPubkey: BLSPubkey,
    toExecutionAddress: ExecutionAddress,
  },
  {typeName: "BLSToExecutionChange", jsonCase: "eth2"}
);

export const SignedBLSToExecutionChange = new ContainerType(
  {
    message: BLSToExecutionChange,
    signature: BLSSignature,
  },
  {typeName: "SignedBLSToExecutionChange", jsonCase: "eth2"}
);

export const Withdrawals = new ListCompositeType(Withdrawal, MAX_WITHDRAWALS_PER_PAYLOAD);
export const ExecutionPayload = new ContainerType(
  {
    ...bellatrixSsz.ExecutionPayload.fields,
    withdrawals: Withdrawals, // New in capella
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = new ContainerType(
  {
    ...bellatrixSsz.ExecutionPayloadHeader.fields,
    withdrawalsRoot: Root, // New in capella
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

export const ValidatorContainer = new ContainerType(
  {
    ...phase0Ssz.ValidatorContainer.fields,
    fullyWithdrawnEpoch: EpochInf,
  },
  {typeName: "Validator", jsonCase: "eth2"}
);
export const ValidatorNodeStruct = new ContainerNodeStructType(ValidatorContainer.fields, ValidatorContainer.opts);
// The main Validator type is the 'ContainerNodeStructType' version
export const Validator = ValidatorNodeStruct;
export const Validators = new ListCompositeType(ValidatorNodeStruct, VALIDATOR_REGISTRY_LIMIT);

export const BLSToExecutionChanges = new ListCompositeType(BLSToExecutionChange, MAX_BLS_TO_EXECUTION_CHANGES);
export const BeaconBlockBody = new ContainerType(
  {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayload: ExecutionPayload, // Modified in capella
    blsToExecutionChanges: BLSToExecutionChanges,
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
    body: BeaconBlockBody, // Modified in Capella
  },
  {typeName: "BeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = new ContainerType(
  {
    message: BeaconBlock, // Modified in capella
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlock", jsonCase: "eth2"}
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

export const WithdrawalQueue = new ListCompositeType(Withdrawal, WITHDRAWAL_QUEUE_LIMIT);

// we don't reuse bellatrix.BeaconState fields since we need to replace some keys
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
    validators: Validators, // [Modified in Capella]
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
    withdrawalQueue: WithdrawalQueue, // [New in Capella]
    nextWithdrawalIndex: WithdrawalIndex, // [New in Capella]
    nextPartialWithdrawalValidatorIndex: ValidatorIndex, //[New in Capella]
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const BlindedBeaconBlockBody = new ContainerType(
  {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayloadHeader: ExecutionPayloadHeader, // Modified in capella
    blsToExecutionChanges: BLSToExecutionChanges, // New in capella
  },
  {typeName: "BlindedBeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BlindedBeaconBlock = new ContainerType(
  {
    slot: Slot,
    proposerIndex: ValidatorIndex,
    // Reclare expandedType() with altair block and altair state
    parentRoot: Root,
    stateRoot: Root,
    body: BlindedBeaconBlockBody, // Modified in capella
  },
  {typeName: "BlindedBeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBlindedBeaconBlock = new ContainerType(
  {
    message: BlindedBeaconBlock, // Modified in capella
    signature: BLSSignature,
  },
  {typeName: "SignedBlindedBeaconBlock", jsonCase: "eth2"}
);
