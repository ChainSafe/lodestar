import {ContainerType} from "@chainsafe/ssz";
import {IBeaconSSZTypes} from "../interface";

export const SignedBeaconHeaderResponse = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      root: ssz.Root,
      canonical: ssz.Boolean,
      header: ssz.SignedBeaconBlockHeader,
    },
  });

export const SubscribeToCommitteeSubnetPayload = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      slot: ssz.Slot,
      slotSignature: ssz.BLSSignature,
      attestationCommitteeIndex: ssz.CommitteeIndex,
      aggregatorPubkey: ssz.BLSPubkey,
    },
  });

export const AttesterDuty = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      pubkey: ssz.BLSPubkey,
      validatorIndex: ssz.ValidatorIndex,
      committeeIndex: ssz.CommitteeIndex,
      committeeLength: ssz.Number64,
      committeesAtSlot: ssz.Number64,
      validatorCommitteeIndex: ssz.Number64,
      slot: ssz.Slot,
    },
  });

export const ProposerDuty = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      slot: ssz.Slot,
      validatorIndex: ssz.ValidatorIndex,
      pubkey: ssz.BLSPubkey,
    },
  });

export const SyncingStatus = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      headSlot: ssz.Uint64,
      syncDistance: ssz.Uint64,
    },
  });

export const ValidatorResponse = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      index: ssz.ValidatorIndex,
      pubkey: ssz.BLSPubkey,
      balance: ssz.Gwei,
      validator: ssz.Validator,
    },
  });

export const Genesis = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      genesisValidatorsRoot: ssz.Root,
      genesisTime: ssz.Uint64,
      genesisForkVersion: ssz.Version,
    },
  });

export const ChainHead = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      slot: ssz.Slot,
      block: ssz.Root,
      state: ssz.Root,
      epochTransition: ssz.Boolean,
    },
  });

export const BlockEventPayload = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      slot: ssz.Slot,
      block: ssz.Root,
    },
  });

export const FinalizedCheckpoint = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      block: ssz.Root,
      state: ssz.Root,
      epoch: ssz.Epoch,
    },
  });

export const ChainReorg = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      slot: ssz.Slot,
      depth: ssz.Number64,
      oldHeadBlock: ssz.Root,
      newHeadBlock: ssz.Root,
      oldHeadState: ssz.Root,
      newHeadState: ssz.Root,
      epoch: ssz.Epoch,
    },
  });

export const FinalityCheckpoints = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      previousJustified: ssz.Checkpoint,
      currentJustified: ssz.Checkpoint,
      finalized: ssz.Checkpoint,
    },
  });
