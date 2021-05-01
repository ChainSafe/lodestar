import {
  IPhase0Params,
  ATTESTATION_SUBNET_COUNT,
  DEPOSIT_CONTRACT_TREE_DEPTH,
  JUSTIFICATION_BITS_LENGTH,
  MAX_REQUEST_BLOCKS,
  P2P_ERROR_MESSAGE_MAX_LENGTH,
} from "@chainsafe/lodestar-params";
import {BitListType, BitVectorType, ContainerType, List, ListType, RootType, Vector, VectorType} from "@chainsafe/ssz";
import {PrimitiveSSZTypes} from "../primitive";
import {StringType} from "../utils/StringType";
import {LazyVariable} from "../utils/lazyVar";
import {ValidatorStatus} from "./types";
import * as phase0 from "./types";

// Interface is defined in the return of getPhase0Types(), to de-duplicate info
// To add a new type, create and return it in the body of getPhase0Types()
export type Phase0SSZTypes = ReturnType<typeof getPhase0Types>;

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types,@typescript-eslint/explicit-function-return-type
export function getPhase0Types(params: IPhase0Params, primitive: PrimitiveSSZTypes) {
  const {
    BLSSignature,
    BLSPubkey,
    Version,
    Slot,
    Uint8,
    Uint64,
    Root,
    Gwei,
    Boolean,
    Number64,
    Epoch,
    ForkDigest,
    CommitteeIndex,
    ValidatorIndex,
    Bytes32,
    Domain,
  } = primitive;

  // So the expandedRoots can be referenced, and break the circular dependency
  const typesRef = new LazyVariable<{
    BeaconBlock: ContainerType<phase0.BeaconBlock>;
    BeaconState: ContainerType<phase0.BeaconState>;
  }>();

  // Misc types
  // ==========

  const AttestationSubnets = new BitVectorType({
    length: ATTESTATION_SUBNET_COUNT,
  });

  const BeaconBlockHeader = new ContainerType<phase0.BeaconBlockHeader>({
    fields: {
      slot: Slot,
      proposerIndex: ValidatorIndex,
      parentRoot: Root,
      stateRoot: Root,
      bodyRoot: Root,
    },
  });

  const SignedBeaconBlockHeader = new ContainerType<phase0.SignedBeaconBlockHeader>({
    fields: {
      message: BeaconBlockHeader,
      signature: BLSSignature,
    },
  });

  const Checkpoint = new ContainerType<phase0.Checkpoint>({
    fields: {
      epoch: Epoch,
      root: Root,
    },
  });

  const CommitteeBits = new BitListType({
    limit: params.MAX_VALIDATORS_PER_COMMITTEE,
  });

  const CommitteeIndices = new ListType<List<phase0.ValidatorIndex>>({
    elementType: ValidatorIndex,
    limit: params.MAX_VALIDATORS_PER_COMMITTEE,
  });

  const DepositMessage = new ContainerType<phase0.DepositMessage>({
    fields: {
      pubkey: BLSPubkey,
      withdrawalCredentials: Bytes32,
      amount: Gwei,
    },
  });

  const DepositData = new ContainerType<phase0.DepositData>({
    fields: {
      pubkey: BLSPubkey,
      withdrawalCredentials: Bytes32,
      amount: Gwei,
      signature: BLSSignature,
    },
  });

  const DepositDataRootList = new ListType<List<phase0.Root>>({
    elementType: new RootType({expandedType: DepositData}),
    limit: 2 ** DEPOSIT_CONTRACT_TREE_DEPTH,
  });

  const DepositEvent = new ContainerType<phase0.DepositEvent>({
    fields: {
      depositData: DepositData,
      blockNumber: Number64,
      index: Number64,
    },
  });

  const Eth1Data = new ContainerType<phase0.Eth1Data>({
    fields: {
      depositRoot: Root,
      depositCount: Number64,
      blockHash: Bytes32,
    },
  });

  const Eth1DataOrdered = new ContainerType<phase0.Eth1DataOrdered>({
    fields: {
      depositRoot: Root,
      depositCount: Number64,
      blockHash: Bytes32,
      blockNumber: Number64,
    },
  });

  const Fork = new ContainerType<phase0.Fork>({
    fields: {
      previousVersion: Version,
      currentVersion: Version,
      epoch: Epoch,
    },
  });

  const ForkData = new ContainerType<phase0.ForkData>({
    fields: {
      currentVersion: Version,
      genesisValidatorsRoot: Root,
    },
  });

  const ENRForkID = new ContainerType<phase0.ENRForkID>({
    fields: {
      forkDigest: ForkDigest,
      nextForkVersion: Version,
      nextForkEpoch: Epoch,
    },
  });

  const HistoricalBlockRoots = new VectorType<Vector<phase0.Root>>({
    elementType: new RootType({expandedType: () => typesRef.get().BeaconBlock}),
    length: params.SLOTS_PER_HISTORICAL_ROOT,
  });

  const HistoricalStateRoots = new VectorType<Vector<phase0.Root>>({
    elementType: new RootType({expandedType: () => typesRef.get().BeaconState}),
    length: params.SLOTS_PER_HISTORICAL_ROOT,
  });

  const HistoricalBatch = new ContainerType<phase0.HistoricalBatch>({
    fields: {
      blockRoots: HistoricalBlockRoots,
      stateRoots: HistoricalStateRoots,
    },
  });

  const SlotRoot = new ContainerType<phase0.SlotRoot>({
    fields: {
      slot: Slot,
      root: Root,
    },
  });

  const Validator = new ContainerType<phase0.Validator>({
    fields: {
      pubkey: BLSPubkey,
      withdrawalCredentials: Bytes32,
      effectiveBalance: Gwei,
      slashed: Boolean,
      activationEligibilityEpoch: Epoch,
      activationEpoch: Epoch,
      exitEpoch: Epoch,
      withdrawableEpoch: Epoch,
    },
  });

  // Misc dependants

  const AttestationData = new ContainerType<phase0.AttestationData>({
    fields: {
      slot: Slot,
      index: CommitteeIndex,
      beaconBlockRoot: Root,
      source: Checkpoint,
      target: Checkpoint,
    },
  });

  const IndexedAttestation = new ContainerType<phase0.IndexedAttestation>({
    fields: {
      attestingIndices: CommitteeIndices,
      data: AttestationData,
      signature: BLSSignature,
    },
  });

  const PendingAttestation = new ContainerType<phase0.PendingAttestation>({
    fields: {
      aggregationBits: CommitteeBits,
      data: AttestationData,
      inclusionDelay: Slot,
      proposerIndex: ValidatorIndex,
    },
  });

  const SigningData = new ContainerType<phase0.SigningData>({
    fields: {
      objectRoot: Root,
      domain: Domain,
    },
  });

  // Operations types
  // ================

  const Attestation = new ContainerType<phase0.Attestation>({
    fields: {
      aggregationBits: CommitteeBits,
      data: AttestationData,
      signature: BLSSignature,
    },
  });

  const AttesterSlashing = new ContainerType<phase0.AttesterSlashing>({
    fields: {
      attestation1: IndexedAttestation,
      attestation2: IndexedAttestation,
    },
  });

  const Deposit = new ContainerType<phase0.Deposit>({
    fields: {
      proof: new VectorType({elementType: Bytes32, length: DEPOSIT_CONTRACT_TREE_DEPTH + 1}),
      data: DepositData,
    },
  });

  const ProposerSlashing = new ContainerType<phase0.ProposerSlashing>({
    fields: {
      signedHeader1: SignedBeaconBlockHeader,
      signedHeader2: SignedBeaconBlockHeader,
    },
  });

  const VoluntaryExit = new ContainerType<phase0.VoluntaryExit>({
    fields: {
      epoch: Epoch,
      validatorIndex: ValidatorIndex,
    },
  });

  const SignedVoluntaryExit = new ContainerType<phase0.SignedVoluntaryExit>({
    fields: {
      message: VoluntaryExit,
      signature: BLSSignature,
    },
  });

  // Block types
  // ===========

  const BeaconBlockBody = new ContainerType<phase0.BeaconBlockBody>({
    fields: {
      randaoReveal: BLSSignature,
      eth1Data: Eth1Data,
      graffiti: Bytes32,
      proposerSlashings: new ListType({elementType: ProposerSlashing, limit: params.MAX_PROPOSER_SLASHINGS}),
      attesterSlashings: new ListType({elementType: AttesterSlashing, limit: params.MAX_ATTESTER_SLASHINGS}),
      attestations: new ListType({elementType: Attestation, limit: params.MAX_ATTESTATIONS}),
      deposits: new ListType({elementType: Deposit, limit: params.MAX_DEPOSITS}),
      voluntaryExits: new ListType({elementType: SignedVoluntaryExit, limit: params.MAX_VOLUNTARY_EXITS}),
    },
  });

  const BeaconBlock = new ContainerType<phase0.BeaconBlock>({
    fields: {
      slot: Slot,
      proposerIndex: ValidatorIndex,
      parentRoot: new RootType({expandedType: () => typesRef.get().BeaconBlock}),
      stateRoot: new RootType({expandedType: () => typesRef.get().BeaconState}),
      body: BeaconBlockBody,
    },
  });

  const SignedBeaconBlock = new ContainerType<phase0.SignedBeaconBlock>({
    fields: {
      message: BeaconBlock,
      signature: BLSSignature,
    },
  });

  // State types
  // ===========

  const EpochAttestations = new ListType<List<phase0.PendingAttestation>>({
    elementType: PendingAttestation,
    limit: params.MAX_ATTESTATIONS * params.SLOTS_PER_EPOCH,
  });

  const BeaconState = new ContainerType<phase0.BeaconState>({
    fields: {
      // Misc
      genesisTime: Number64,
      genesisValidatorsRoot: Root,
      slot: Slot,
      fork: Fork,
      // History
      latestBlockHeader: BeaconBlockHeader,
      blockRoots: HistoricalBlockRoots,
      stateRoots: HistoricalStateRoots,
      historicalRoots: new ListType({
        elementType: new RootType({expandedType: HistoricalBatch}),
        limit: params.HISTORICAL_ROOTS_LIMIT,
      }),
      // Eth1
      eth1Data: Eth1Data,
      eth1DataVotes: new ListType({
        elementType: Eth1Data,
        limit: params.EPOCHS_PER_ETH1_VOTING_PERIOD * params.SLOTS_PER_EPOCH,
      }),
      eth1DepositIndex: Number64,
      // Registry
      validators: new ListType({elementType: Validator, limit: params.VALIDATOR_REGISTRY_LIMIT}),
      balances: new ListType({elementType: Gwei, limit: params.VALIDATOR_REGISTRY_LIMIT}),
      randaoMixes: new VectorType({elementType: Bytes32, length: params.EPOCHS_PER_HISTORICAL_VECTOR}),
      // Slashings
      slashings: new VectorType({elementType: Gwei, length: params.EPOCHS_PER_SLASHINGS_VECTOR}),
      // Attestations
      previousEpochAttestations: EpochAttestations,
      currentEpochAttestations: EpochAttestations,
      // Finality
      justificationBits: new BitVectorType({length: JUSTIFICATION_BITS_LENGTH}),
      previousJustifiedCheckpoint: Checkpoint,
      currentJustifiedCheckpoint: Checkpoint,
      finalizedCheckpoint: Checkpoint,
    },
  });

  // Validator types
  // ===============

  const CommitteeAssignment = new ContainerType<phase0.CommitteeAssignment>({
    fields: {
      validators: CommitteeIndices,
      committeeIndex: CommitteeIndex,
      slot: Slot,
    },
  });

  const AggregateAndProof = new ContainerType<phase0.AggregateAndProof>({
    fields: {
      aggregatorIndex: ValidatorIndex,
      aggregate: Attestation,
      selectionProof: BLSSignature,
    },
  });

  const SignedAggregateAndProof = new ContainerType<phase0.SignedAggregateAndProof>({
    fields: {
      message: AggregateAndProof,
      signature: BLSSignature,
    },
  });

  // ReqResp types
  // =============

  const Status = new ContainerType<phase0.Status>({
    fields: {
      forkDigest: ForkDigest,
      finalizedRoot: Root,
      finalizedEpoch: Epoch,
      headRoot: Root,
      headSlot: Slot,
    },
  });

  const Goodbye = Uint64;

  const Ping = Uint64;

  const Metadata = new ContainerType<phase0.Metadata>({
    fields: {
      seqNumber: Uint64,
      attnets: AttestationSubnets,
    },
  });

  const BeaconBlocksByRangeRequest = new ContainerType<phase0.BeaconBlocksByRangeRequest>({
    fields: {
      startSlot: Slot,
      count: Number64,
      step: Number64,
    },
  });

  const BeaconBlocksByRootRequest = new ListType({elementType: Root, limit: MAX_REQUEST_BLOCKS});

  // TODO: Delete
  const P2pErrorMessage = new ListType({elementType: Uint8, limit: P2P_ERROR_MESSAGE_MAX_LENGTH});

  // Api types
  // =========

  const AttesterDuty = new ContainerType<phase0.AttesterDuty>({
    fields: {
      pubkey: BLSPubkey,
      validatorIndex: ValidatorIndex,
      committeeIndex: CommitteeIndex,
      committeeLength: Number64,
      committeesAtSlot: Number64,
      validatorCommitteeIndex: Number64,
      slot: Slot,
    },
  });

  const AttesterDutiesApi = new ContainerType<phase0.AttesterDutiesApi>({
    fields: {
      data: new ListType({elementType: AttesterDuty, limit: params.VALIDATOR_REGISTRY_LIMIT}),
      dependentRoot: Root,
    },
  });

  const BeaconCommitteeResponse = new ContainerType<phase0.BeaconCommitteeResponse>({
    fields: {
      index: CommitteeIndex,
      slot: Slot,
      validators: CommitteeIndices,
    },
  });

  const BeaconCommitteeSubscription = new ContainerType<phase0.BeaconCommitteeSubscription>({
    fields: {
      validatorIndex: ValidatorIndex,
      committeeIndex: CommitteeIndex,
      committeesAtSlot: Slot,
      slot: Slot,
      isAggregator: Boolean,
    },
  });

  const BlockEventPayload = new ContainerType<phase0.BlockEventPayload>({
    fields: {
      slot: Slot,
      block: Root,
    },
  });

  const ChainHead = new ContainerType<phase0.ChainHead>({
    fields: {
      slot: Slot,
      block: Root,
      state: Root,
      epochTransition: Boolean,
    },
  });

  const ChainReorg = new ContainerType<phase0.ChainReorg>({
    fields: {
      slot: Slot,
      depth: Number64,
      oldHeadBlock: Root,
      newHeadBlock: Root,
      oldHeadState: Root,
      newHeadState: Root,
      epoch: Epoch,
    },
  });

  const Contract = new ContainerType<phase0.Contract>({
    fields: {
      chainId: Number64,
      address: Bytes32,
    },
  });

  const FinalityCheckpoints = new ContainerType<phase0.FinalityCheckpoints>({
    fields: {
      previousJustified: Checkpoint,
      currentJustified: Checkpoint,
      finalized: Checkpoint,
    },
  });

  const FinalizedCheckpoint = new ContainerType<phase0.FinalizedCheckpoint>({
    fields: {
      block: Root,
      state: Root,
      epoch: Epoch,
    },
  });

  const Genesis = new ContainerType<phase0.Genesis>({
    fields: {
      genesisValidatorsRoot: Root,
      genesisTime: Uint64,
      genesisForkVersion: Version,
    },
  });

  const ProposerDuty = new ContainerType<phase0.ProposerDuty>({
    fields: {
      slot: Slot,
      validatorIndex: ValidatorIndex,
      pubkey: BLSPubkey,
    },
  });

  const ProposerDutiesApi = new ContainerType<phase0.ProposerDutiesApi>({
    fields: {
      data: new ListType({elementType: ProposerDuty, limit: params.VALIDATOR_REGISTRY_LIMIT}),
      dependentRoot: Root,
    },
  });

  const SignedBeaconHeaderResponse = new ContainerType<phase0.SignedBeaconHeaderResponse>({
    fields: {
      root: Root,
      canonical: Boolean,
      header: SignedBeaconBlockHeader,
    },
  });

  const SubscribeToCommitteeSubnetPayload = new ContainerType<phase0.SubscribeToCommitteeSubnetPayload>({
    fields: {
      slot: Slot,
      slotSignature: BLSSignature,
      attestationCommitteeIndex: CommitteeIndex,
      aggregatorPubkey: BLSPubkey,
    },
  });

  const SyncingStatus = new ContainerType<phase0.SyncingStatus>({
    fields: {
      headSlot: Uint64,
      syncDistance: Uint64,
    },
  });

  const ValidatorBalance = new ContainerType<phase0.ValidatorBalance>({
    fields: {
      index: ValidatorIndex,
      balance: Gwei,
    },
  });

  const ValidatorResponse = new ContainerType<phase0.ValidatorResponse>({
    fields: {
      index: ValidatorIndex,
      balance: Gwei,
      status: new StringType<ValidatorStatus>(),
      validator: Validator,
    },
  });

  // Non-speced types
  // ================

  const SlashingProtectionBlock = new ContainerType<phase0.SlashingProtectionBlock>({
    fields: {
      slot: Slot,
      signingRoot: Root,
    },
  });

  const SlashingProtectionAttestation = new ContainerType<phase0.SlashingProtectionAttestation>({
    fields: {
      sourceEpoch: Epoch,
      targetEpoch: Epoch,
      signingRoot: Root,
    },
  });

  const SlashingProtectionAttestationLowerBound = new ContainerType<phase0.SlashingProtectionAttestationLowerBound>({
    fields: {
      minSourceEpoch: Epoch,
      minTargetEpoch: Epoch,
    },
  });

  // MUST set typesRef here, otherwise expandedType() calls will throw
  typesRef.set({BeaconBlock, BeaconState});

  return {
    // misc
    Fork,
    ForkData,
    ENRForkID,
    Checkpoint,
    SlotRoot,
    Validator,
    AttestationData,
    CommitteeIndices,
    IndexedAttestation,
    CommitteeBits,
    PendingAttestation,
    Eth1Data,
    Eth1DataOrdered,
    HistoricalBlockRoots,
    HistoricalStateRoots,
    HistoricalBatch,
    DepositMessage,
    DepositData,
    DepositEvent,
    BeaconBlockHeader,
    SignedBeaconBlockHeader,
    SigningData,
    DepositDataRootList,
    AttestationSubnets,
    // operations
    ProposerSlashing,
    AttesterSlashing,
    Attestation,
    Deposit,
    VoluntaryExit,
    SignedVoluntaryExit,
    // block
    BeaconBlockBody,
    BeaconBlock,
    SignedBeaconBlock,
    // state
    EpochAttestations,
    BeaconState,
    // validator
    AggregateAndProof,
    SignedAggregateAndProof,
    CommitteeAssignment,
    // Validator slashing protection

    // wire
    Status,
    Goodbye,
    Ping,
    Metadata,
    BeaconBlocksByRangeRequest,
    BeaconBlocksByRootRequest,
    P2pErrorMessage,
    // api
    SignedBeaconHeaderResponse,
    SubscribeToCommitteeSubnetPayload,
    SyncingStatus,
    AttesterDuty,
    ProposerDuty,
    AttesterDutiesApi,
    ProposerDutiesApi,
    BeaconCommitteeSubscription,
    Genesis,
    ChainHead,
    BlockEventPayload,
    FinalizedCheckpoint,
    ChainReorg,
    ValidatorBalance,
    ValidatorResponse,
    FinalityCheckpoints,
    BeaconCommitteeResponse,
    Contract,
    // Non-speced types
    SlashingProtectionBlock,
    SlashingProtectionAttestation,
    SlashingProtectionAttestationLowerBound,
  };
}
