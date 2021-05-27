import {
  IBeaconParams,
  JUSTIFICATION_BITS_LENGTH,
  MAX_VALID_LIGHT_CLIENT_UPDATES,
  FINALIZED_ROOT_INDEX_FLOORLOG2,
  NEXT_SYNC_COMMITTEE_INDEX_FLOORLOG2,
  SYNC_COMMITTEE_SUBNET_COUNT,
} from "@chainsafe/lodestar-params";
import {BitVectorType, ContainerType, VectorType, ListType, RootType, BitListType, Vector} from "@chainsafe/ssz";
import {Phase0SSZTypes} from "../phase0";
import {PrimitiveSSZTypes} from "../primitive";
import {LazyVariable} from "../utils/lazyVar";
import * as altair from "./types";

// Interface is defined in the return of getAltairTypes(), to de-duplicate info
// To add a new type, create and return it in the body of getAltairTypes()
export type AltairSSZTypes = ReturnType<typeof getAltairTypes>;

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types,@typescript-eslint/explicit-function-return-type
export function getAltairTypes(params: IBeaconParams, primitive: PrimitiveSSZTypes, phase0: Phase0SSZTypes) {
  const {
    Bytes32,
    Number64,
    Uint64,
    Slot,
    SubCommitteeIndex,
    ValidatorIndex,
    Gwei,
    Root,
    Version,
    BLSPubkey,
    BLSSignature,
    ParticipationFlags,
  } = primitive;

  // So the expandedRoots can be referenced, and break the circular dependency
  const typesRef = new LazyVariable<{
    BeaconBlock: ContainerType<altair.BeaconBlock>;
    BeaconState: ContainerType<altair.BeaconState>;
  }>();

  const SyncSubnets = new BitVectorType({
    length: SYNC_COMMITTEE_SUBNET_COUNT,
  });

  const Metadata = new ContainerType<altair.Metadata>({
    fields: {
      seqNumber: Uint64,
      attnets: phase0.AttestationSubnets,
      syncnets: SyncSubnets,
    },
  });

  const SyncCommittee = new ContainerType<altair.SyncCommittee>({
    fields: {
      pubkeys: new VectorType({elementType: BLSPubkey, length: params.SYNC_COMMITTEE_SIZE}),
      pubkeyAggregates: new VectorType({
        elementType: BLSPubkey,
        length: Math.floor(params.SYNC_COMMITTEE_SIZE / params.SYNC_PUBKEYS_PER_AGGREGATE),
      }),
    },
  });

  const SyncCommitteeSignature = new ContainerType<altair.SyncCommitteeSignature>({
    fields: {
      slot: Slot,
      beaconBlockRoot: Root,
      validatorIndex: ValidatorIndex,
      signature: BLSSignature,
    },
  });

  const SyncCommitteeContribution = new ContainerType<altair.SyncCommitteeContribution>({
    fields: {
      slot: Slot,
      beaconBlockRoot: Root,
      subCommitteeIndex: SubCommitteeIndex,
      aggregationBits: new BitListType({limit: params.SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT}),
      signature: BLSSignature,
    },
  });

  const ContributionAndProof = new ContainerType<altair.ContributionAndProof>({
    fields: {
      aggregatorIndex: ValidatorIndex,
      contribution: SyncCommitteeContribution,
      selectionProof: BLSSignature,
    },
  });

  const SignedContributionAndProof = new ContainerType<altair.SignedContributionAndProof>({
    fields: {
      message: ContributionAndProof,
      signature: BLSSignature,
    },
  });

  const SyncCommitteeSigningData = new ContainerType<altair.SyncCommitteeSigningData>({
    fields: {
      slot: Slot,
      subCommitteeIndex: SubCommitteeIndex,
    },
  });

  const SyncAggregate = new ContainerType<altair.SyncAggregate>({
    fields: {
      syncCommitteeBits: new BitVectorType({length: params.SYNC_COMMITTEE_SIZE}),
      syncCommitteeSignature: BLSSignature,
    },
  });

  // Re-declare with the new expanded type
  const HistoricalBlockRoots = new VectorType<Vector<altair.Root>>({
    elementType: new RootType({expandedType: () => typesRef.get().BeaconBlock}),
    length: params.SLOTS_PER_HISTORICAL_ROOT,
  });

  const HistoricalStateRoots = new VectorType<Vector<altair.Root>>({
    elementType: new RootType({expandedType: () => typesRef.get().BeaconState}),
    length: params.SLOTS_PER_HISTORICAL_ROOT,
  });

  const HistoricalBatch = new ContainerType<altair.HistoricalBatch>({
    fields: {
      blockRoots: HistoricalBlockRoots,
      stateRoots: HistoricalStateRoots,
    },
  });

  const BeaconBlockBody = new ContainerType<altair.BeaconBlockBody>({
    fields: {
      ...phase0.BeaconBlockBody.fields,
      syncAggregate: SyncAggregate,
    },
  });

  const BeaconBlock = new ContainerType<altair.BeaconBlock>({
    fields: {
      slot: Slot,
      proposerIndex: ValidatorIndex,
      // Reclare expandedType() with altair block and altair state
      parentRoot: new RootType({expandedType: () => typesRef.get().BeaconBlock}),
      stateRoot: new RootType({expandedType: () => typesRef.get().BeaconState}),
      body: BeaconBlockBody,
    },
  });

  const SignedBeaconBlock = new ContainerType<altair.SignedBeaconBlock>({
    fields: {
      message: BeaconBlock,
      signature: BLSSignature,
    },
  });

  //we don't reuse phase0.BeaconState fields since we need to replace some keys
  //and we cannot keep order doing that
  const BeaconState = new ContainerType<altair.BeaconState>({
    fields: {
      genesisTime: Number64,
      genesisValidatorsRoot: Root,
      slot: Slot,
      fork: phase0.Fork,
      // History
      latestBlockHeader: phase0.BeaconBlockHeader,
      blockRoots: HistoricalBlockRoots,
      stateRoots: HistoricalStateRoots,
      historicalRoots: new ListType({
        elementType: new RootType({expandedType: HistoricalBatch}),
        limit: params.HISTORICAL_ROOTS_LIMIT,
      }),
      // Eth1
      eth1Data: phase0.Eth1Data,
      eth1DataVotes: new ListType({
        elementType: phase0.Eth1Data,
        limit: params.EPOCHS_PER_ETH1_VOTING_PERIOD * params.SLOTS_PER_EPOCH,
      }),
      eth1DepositIndex: Number64,
      // Registry
      validators: new ListType({elementType: phase0.Validator, limit: params.VALIDATOR_REGISTRY_LIMIT}),
      balances: new ListType({elementType: Gwei, limit: params.VALIDATOR_REGISTRY_LIMIT}),
      randaoMixes: new VectorType({elementType: Bytes32, length: params.EPOCHS_PER_HISTORICAL_VECTOR}),
      // Slashings
      slashings: new VectorType({elementType: Gwei, length: params.EPOCHS_PER_SLASHINGS_VECTOR}),
      // Participation
      previousEpochParticipation: new ListType({
        elementType: ParticipationFlags,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      currentEpochParticipation: new ListType({
        elementType: ParticipationFlags,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      // Finality
      justificationBits: new BitVectorType({length: JUSTIFICATION_BITS_LENGTH}),
      previousJustifiedCheckpoint: phase0.Checkpoint,
      currentJustifiedCheckpoint: phase0.Checkpoint,
      finalizedCheckpoint: phase0.Checkpoint,
      // Inactivity
      inactivityScores: new ListType({elementType: Number64, limit: params.VALIDATOR_REGISTRY_LIMIT}),
      // Sync
      currentSyncCommittee: SyncCommittee,
      nextSyncCommittee: SyncCommittee,
    },
  });

  const LightClientSnapshot = new ContainerType<altair.LightClientSnapshot>({
    fields: {
      header: phase0.BeaconBlockHeader,
      nextSyncCommittee: SyncCommittee,
      currentSyncCommittee: SyncCommittee,
    },
  });

  const LightClientUpdate = new ContainerType<altair.LightClientUpdate>({
    fields: {
      header: phase0.BeaconBlockHeader,
      nextSyncCommittee: SyncCommittee,
      nextSyncCommitteeBranch: new VectorType({
        elementType: Bytes32,
        length: NEXT_SYNC_COMMITTEE_INDEX_FLOORLOG2,
      }),
      finalityHeader: phase0.BeaconBlockHeader,
      finalityBranch: new VectorType({elementType: Bytes32, length: FINALIZED_ROOT_INDEX_FLOORLOG2}),
      syncCommitteeBits: new BitVectorType({length: params.SYNC_COMMITTEE_SIZE}),
      syncCommitteeSignature: BLSSignature,
      forkVersion: Version,
    },
  });

  const LightClientStore = new ContainerType<altair.LightClientStore>({
    fields: {
      snapshot: LightClientSnapshot,
      validUpdates: new ListType({elementType: LightClientUpdate, limit: MAX_VALID_LIGHT_CLIENT_UPDATES}),
    },
  });

  // MUST set typesRef here, otherwise expandedType() calls will throw
  typesRef.set({BeaconBlock, BeaconState});

  return {
    SyncSubnets,
    SyncCommittee,
    SyncCommitteeSignature,
    SyncCommitteeContribution,
    ContributionAndProof,
    SignedContributionAndProof,
    SyncCommitteeSigningData,
    SyncAggregate,
    BeaconBlockBody,
    BeaconBlock,
    SignedBeaconBlock,
    BeaconState,
    LightClientSnapshot,
    LightClientUpdate,
    LightClientStore,
    Metadata,
  };
}
