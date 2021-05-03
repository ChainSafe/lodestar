import {
  IBeaconParams,
  JUSTIFICATION_BITS_LENGTH,
  MAX_VALID_LIGHT_CLIENT_UPDATES,
  FINALIZED_ROOT_INDEX_FLOORLOG2,
  NEXT_SYNC_COMMITTEE_INDEX_FLOORLOG2,
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
export function getAltairTypes(params: IBeaconParams, phase0: Phase0SSZTypes & PrimitiveSSZTypes) {
  // So the expandedRoots can be referenced, and break the circular dependency
  const typesRef = new LazyVariable<{
    BeaconBlock: ContainerType<altair.BeaconBlock>;
    BeaconState: ContainerType<altair.BeaconState>;
  }>();

  const SyncCommittee = new ContainerType<altair.SyncCommittee>({
    fields: {
      pubkeys: new VectorType({elementType: phase0.BLSPubkey, length: params.SYNC_COMMITTEE_SIZE}),
      pubkeyAggregates: new VectorType({
        elementType: phase0.BLSPubkey,
        length: Math.floor(params.SYNC_COMMITTEE_SIZE / params.SYNC_PUBKEYS_PER_AGGREGATE),
      }),
    },
  });

  const SyncCommitteeSignature = new ContainerType<altair.SyncCommitteeSignature>({
    fields: {
      slot: phase0.Slot,
      beaconBlockRoot: phase0.Root,
      validatorIndex: phase0.ValidatorIndex,
      signature: phase0.BLSSignature,
    },
  });

  const SyncCommitteeContribution = new ContainerType<altair.SyncCommitteeContribution>({
    fields: {
      slot: phase0.Slot,
      beaconBlockRoot: phase0.Root,
      subCommitteeIndex: phase0.SubCommitteeIndex,
      aggregationBits: new BitListType({limit: params.SYNC_COMMITTEE_SIZE / params.SYNC_COMMITTEE_SUBNET_COUNT}),
      signature: phase0.BLSSignature,
    },
  });

  const ContributionAndProof = new ContainerType<altair.ContributionAndProof>({
    fields: {
      aggregatorIndex: phase0.ValidatorIndex,
      contribution: SyncCommitteeContribution,
    },
  });

  const SignedContributionAndProof = new ContainerType<altair.SignedContributionAndProof>({
    fields: {
      message: ContributionAndProof,
      signature: phase0.BLSSignature,
    },
  });

  const SyncCommitteeSigningData = new ContainerType<altair.SyncCommitteeSigningData>({
    fields: {
      slot: phase0.Slot,
      subCommitteeIndex: phase0.SubCommitteeIndex,
    },
  });

  const SyncAggregate = new ContainerType<altair.SyncAggregate>({
    fields: {
      syncCommitteeBits: new BitVectorType({length: params.SYNC_COMMITTEE_SIZE}),
      syncCommitteeSignature: phase0.BLSSignature,
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
      slot: phase0.Slot,
      proposerIndex: phase0.ValidatorIndex,
      // Reclare expandedType() with altair block and altair state
      parentRoot: new RootType({expandedType: () => typesRef.get().BeaconBlock}),
      stateRoot: new RootType({expandedType: () => typesRef.get().BeaconState}),
      body: BeaconBlockBody,
    },
  });

  const SignedBeaconBlock = new ContainerType<altair.SignedBeaconBlock>({
    fields: {
      message: BeaconBlock,
      signature: phase0.BLSSignature,
    },
  });

  //we don't reuse phase0.BeaconState fields since we need to replace some keys
  //and we cannot keep order doing that
  const BeaconState = new ContainerType<altair.BeaconState>({
    fields: {
      genesisTime: phase0.Number64,
      genesisValidatorsRoot: phase0.Root,
      slot: phase0.Slot,
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
      eth1DepositIndex: phase0.Number64,
      // Registry
      validators: new ListType({elementType: phase0.Validator, limit: params.VALIDATOR_REGISTRY_LIMIT}),
      balances: new ListType({elementType: phase0.Gwei, limit: params.VALIDATOR_REGISTRY_LIMIT}),
      randaoMixes: new VectorType({elementType: phase0.Bytes32, length: params.EPOCHS_PER_HISTORICAL_VECTOR}),
      // Slashings
      slashings: new VectorType({elementType: phase0.Gwei, length: params.EPOCHS_PER_SLASHINGS_VECTOR}),
      // Participation
      previousEpochParticipation: new ListType({
        elementType: phase0.ParticipationFlags,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      currentEpochParticipation: new ListType({
        elementType: phase0.ParticipationFlags,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      // Finality
      justificationBits: new BitVectorType({length: JUSTIFICATION_BITS_LENGTH}),
      previousJustifiedCheckpoint: phase0.Checkpoint,
      currentJustifiedCheckpoint: phase0.Checkpoint,
      finalizedCheckpoint: phase0.Checkpoint,
      // Inactivity
      inactivityScores: new ListType({elementType: phase0.Number64, limit: params.VALIDATOR_REGISTRY_LIMIT}),
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
        elementType: phase0.Bytes32,
        length: NEXT_SYNC_COMMITTEE_INDEX_FLOORLOG2,
      }),
      finalityHeader: phase0.BeaconBlockHeader,
      finalityBranch: new VectorType({elementType: phase0.Bytes32, length: FINALIZED_ROOT_INDEX_FLOORLOG2}),
      syncCommitteeBits: new BitVectorType({length: params.SYNC_COMMITTEE_SIZE}),
      syncCommitteeSignature: phase0.BLSSignature,
      forkVersion: phase0.Version,
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
  };
}
