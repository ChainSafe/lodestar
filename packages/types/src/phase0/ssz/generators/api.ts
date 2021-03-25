import {ContainerType} from "@chainsafe/ssz";
import {IPhase0SSZTypes} from "../interface";
import {StringType} from "../utils";
import {ValidatorStatus} from "../../types";

export const SignedBeaconHeaderResponse = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      root: ssz.Root,
      canonical: ssz.Boolean,
      header: ssz.SignedBeaconBlockHeader,
    },
  });

export const SubscribeToCommitteeSubnetPayload = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      slot: ssz.Slot,
      slotSignature: ssz.BLSSignature,
      attestationCommitteeIndex: ssz.CommitteeIndex,
      aggregatorPubkey: ssz.BLSPubkey,
    },
  });

export const AttesterDuty = (ssz: IPhase0SSZTypes): ContainerType =>
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

export const ProposerDuty = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      slot: ssz.Slot,
      validatorIndex: ssz.ValidatorIndex,
      pubkey: ssz.BLSPubkey,
    },
  });

export const BeaconCommitteeSubscription = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      validatorIndex: ssz.ValidatorIndex,
      committeeIndex: ssz.CommitteeIndex,
      committeesAtSlot: ssz.Slot,
      slot: ssz.Slot,
      isAggregator: ssz.Boolean,
    },
  });

export const SyncingStatus = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      headSlot: ssz.Uint64,
      syncDistance: ssz.Uint64,
    },
  });

export const Genesis = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      genesisValidatorsRoot: ssz.Root,
      genesisTime: ssz.Uint64,
      genesisForkVersion: ssz.Version,
    },
  });

export const ChainHead = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      slot: ssz.Slot,
      block: ssz.Root,
      state: ssz.Root,
      epochTransition: ssz.Boolean,
    },
  });

export const BlockEventPayload = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      slot: ssz.Slot,
      block: ssz.Root,
    },
  });

export const FinalizedCheckpoint = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      block: ssz.Root,
      state: ssz.Root,
      epoch: ssz.Epoch,
    },
  });

export const ChainReorg = (ssz: IPhase0SSZTypes): ContainerType =>
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

export const FinalityCheckpoints = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      previousJustified: ssz.Checkpoint,
      currentJustified: ssz.Checkpoint,
      finalized: ssz.Checkpoint,
    },
  });

export const BeaconCommitteeResponse = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      index: ssz.CommitteeIndex,
      slot: ssz.Slot,
      validators: ssz.CommitteeIndices,
    },
  });

export const ValidatorResponse = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      index: ssz.ValidatorIndex,
      balance: ssz.Gwei,
      status: new StringType<ValidatorStatus>(),
      validator: ssz.Validator,
    },
  });

export const ValidatorBalance = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      index: ssz.ValidatorIndex,
      balance: ssz.Gwei,
    },
  });

export const Contract = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      chainId: ssz.Number64,
      address: ssz.Bytes32,
    },
  });
