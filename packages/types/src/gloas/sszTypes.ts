import {BitVectorType, ContainerType, ListBasicType, ListCompositeType, VectorCompositeType} from "@chainsafe/ssz";
import {
  BUILDER_PENDING_WITHDRAWALS_LIMIT,
  HISTORICAL_ROOTS_LIMIT,
  MAX_PAYLOAD_ATTESTATIONS,
  NUMBER_OF_COLUMNS,
  PTC_SIZE,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
} from "@lodestar/params";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as capellaSsz} from "../capella/index.js";
import {ssz as denebSsz} from "../deneb/index.js";
import {ssz as electraSsz} from "../electra/index.js";
import {ssz as fuluSsz} from "../fulu/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as primitiveSsz} from "../primitive/index.js";

// biome-ignore lint/suspicious/noShadowRestrictedNames: We explicitly want `Boolean` name to be imported
const {Gwei, ExecutionAddress, ValidatorIndex, Epoch, BLSSignature, Bytes32, Root, Slot, Boolean, UintBn64, UintNum64} =
  primitiveSsz;

export const BuilderPendingWithdrawal = new ContainerType(
  {
    feeRecipient: ExecutionAddress,
    amount: Gwei,
    builderIndex: ValidatorIndex,
    withdrawableEpoch: Epoch,
  },
  {typeName: "BuilderPendingWithdrawal", jsonCase: "eth2"}
);

export const BuilderPendingPayment = new ContainerType(
  {
    weight: Gwei,
    withdrawal: BuilderPendingWithdrawal,
  },
  {typeName: "BuilderPendingPayment", jsonCase: "eth2"}
);

export const PayloadAttestationData = new ContainerType(
  {
    beaconBlockRoot: Root,
    slot: Slot,
    payloadPresent: Boolean,
    blobDataAvailable: Boolean,
  },
  {typeName: "PayloadAttestationData", jsonCase: "eth2"}
);

export const PayloadAttestation = new ContainerType(
  {
    aggregationBits: new BitVectorType(PTC_SIZE),
    data: PayloadAttestationData,
    signature: BLSSignature,
  },
  {typeName: "PayloadAttestation", jsonCase: "eth2"}
);

export const PayloadAttestationMessage = new ContainerType(
  {
    validatorIndex: ValidatorIndex,
    data: PayloadAttestationData,
    signature: BLSSignature,
  },
  {typeName: "PayloadAttestationMessage", jsonCase: "eth2"}
);

export const IndexedPayloadAttestation = new ContainerType(
  {
    attestingIndices: new ListBasicType(ValidatorIndex, PTC_SIZE),
    data: PayloadAttestationData,
    signature: BLSSignature,
  },
  {typeName: "IndexedPayloadAttestation", jsonCase: "eth2"}
);

export const ExecutionPayloadBid = new ContainerType(
  {
    parentBlockHash: Bytes32,
    parentBlockRoot: Root,
    blockHash: Bytes32,
    feeRecipient: ExecutionAddress,
    gasLimit: UintBn64,
    builderIndex: ValidatorIndex,
    slot: Slot,
    value: Gwei,
    blobKzgCommitmentsRoot: Root,
  },
  {typeName: "ExecutionPayloadBid", jsonCase: "eth2"}
);

export const SignedExecutionPayloadBid = new ContainerType(
  {
    message: ExecutionPayloadBid,
    signature: BLSSignature,
  },
  {typeName: "SignedExecutionPayloadBid", jsonCase: "eth2"}
);

export const ExecutionPayloadEnvelope = new ContainerType(
  {
    payload: electraSsz.ExecutionPayload,
    executionRequests: electraSsz.ExecutionRequests,
    builderIndex: ValidatorIndex,
    beaconBlockRoot: Root,
    slot: Slot,
    blobKzgCommitments: denebSsz.BlobKzgCommitments,
    stateRoot: Root,
  },
  {typeName: "ExecutionPayloadEnvelope", jsonCase: "eth2"}
);

export const SignedExecutionPayloadEnvelope = new ContainerType(
  {
    message: ExecutionPayloadEnvelope,
    signature: BLSSignature,
  },
  {typeName: "SignedExecutionPayloadEnvelope", jsonCase: "eth2"}
);

export const BeaconBlockBody = new ContainerType(
  {
    randaoReveal: phase0Ssz.BeaconBlockBody.fields.randaoReveal,
    eth1Data: phase0Ssz.BeaconBlockBody.fields.eth1Data,
    graffiti: phase0Ssz.BeaconBlockBody.fields.graffiti,
    proposerSlashings: phase0Ssz.BeaconBlockBody.fields.proposerSlashings,
    attesterSlashings: electraSsz.BeaconBlockBody.fields.attesterSlashings,
    attestations: electraSsz.BeaconBlockBody.fields.attestations,
    deposits: phase0Ssz.BeaconBlockBody.fields.deposits,
    voluntaryExits: phase0Ssz.BeaconBlockBody.fields.voluntaryExits,
    syncAggregate: altairSsz.BeaconBlockBody.fields.syncAggregate,
    // executionPayload: ExecutionPayload, // Removed in GLOAS:EIP7732
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    // blobKzgCommitments: denebSsz.BeaconBlockBody.fields.blobKzgCommitments, // Removed in GLOAS:EIP7732
    // executionRequests: ExecutionRequests, // Removed in GLOAS:EIP7732
    signedExecutionPayloadBid: SignedExecutionPayloadBid, // New in GLOAS:EIP7732
    payloadAttestations: new ListCompositeType(PayloadAttestation, MAX_PAYLOAD_ATTESTATIONS), // New in GLOAS:EIP7732
  },
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...fuluSsz.BeaconBlock.fields,
    body: BeaconBlockBody, // Modified in GLOAS
  },
  {typeName: "BeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = new ContainerType(
  {
    message: BeaconBlock, // Modified in GLOAS
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlock", jsonCase: "eth2"}
);

export const BeaconState = new ContainerType(
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
    // latestExecutionPayloadHeader: ExecutionPayloadHeader, // Removed in GLOAS:EIP7732
    latestExecutionPayloadBid: ExecutionPayloadBid, // New in GLOAS:EIP7732
    // Withdrawals
    nextWithdrawalIndex: capellaSsz.BeaconState.fields.nextWithdrawalIndex,
    nextWithdrawalValidatorIndex: capellaSsz.BeaconState.fields.nextWithdrawalValidatorIndex,
    // Deep history valid from Capella onwards
    historicalSummaries: capellaSsz.BeaconState.fields.historicalSummaries,
    depositRequestsStartIndex: UintBn64,
    depositBalanceToConsume: Gwei,
    exitBalanceToConsume: Gwei,
    earliestExitEpoch: Epoch,
    consolidationBalanceToConsume: Gwei,
    earliestConsolidationEpoch: Epoch,
    pendingDeposits: electraSsz.BeaconState.fields.pendingDeposits,
    pendingPartialWithdrawals: electraSsz.BeaconState.fields.pendingPartialWithdrawals,
    pendingConsolidations: electraSsz.BeaconState.fields.pendingConsolidations,
    proposerLookahead: fuluSsz.BeaconState.fields.proposerLookahead,
    executionPayloadAvailability: new BitVectorType(SLOTS_PER_HISTORICAL_ROOT), // New in GLOAS:EIP7732
    builderPendingPayments: new VectorCompositeType(BuilderPendingPayment, 2 * SLOTS_PER_EPOCH), // New in GLOAS:EIP7732
    builderPendingWithdrawals: new ListCompositeType(BuilderPendingWithdrawal, BUILDER_PENDING_WITHDRAWALS_LIMIT), // New in GLOAS:EIP7732
    latestBlockHash: Bytes32, // New in GLOAS:EIP7732
    latestWithdrawalsRoot: Root, // New in GLOAS:EIP7732
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const DataColumnSidecar = new ContainerType(
  {
    index: fuluSsz.DataColumnSidecar.fields.index,
    column: fuluSsz.DataColumnSidecar.fields.column,
    kzgCommitments: fuluSsz.DataColumnSidecar.fields.kzgCommitments,
    kzgProofs: fuluSsz.DataColumnSidecar.fields.kzgProofs,
    // signedBlockHeader: phase0Ssz.SignedBeaconBlockHeader, // Removed in GLOAS:EIP7732
    // kzgCommitmentsInclusionProof: KzgCommitmentsInclusionProof, // Removed in GLOAS:EIP7732
    slot: Slot, // New in GLOAS:EIP7732
    beaconBlockRoot: Root, // New in GLOAS:EIP7732
  },
  {typeName: "DataColumnSidecar", jsonCase: "eth2"}
);

export const DataColumnSidecars = new ListCompositeType(DataColumnSidecar, NUMBER_OF_COLUMNS);
