import {IBeaconSSZTypes} from "../interface";
import {ContainerType} from "@chainsafe/ssz";

export const SignedBeaconHeaderResponse = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    root: ssz.Root,
    canonical: ssz.Boolean,
    header: ssz.SignedBeaconBlockHeader
  },
});

export const SubscribeToCommitteeSubnetPayload = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    slot: ssz.Slot,
    slotSignature: ssz.BLSSignature,
    attestationCommitteeIndex: ssz.CommitteeIndex,
    aggregatorPubkey: ssz.BLSPubkey
  },
});

export const ForkResponse = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    fork: ssz.Fork,
    chainId: ssz.Uint64,
    genesisValidatorsRoot: ssz.Root,
  }
});

export const AttesterDuty = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    validatorPubkey: ssz.BLSPubkey,
    aggregatorModulo: ssz.Number64,
    committeeIndex: ssz.CommitteeIndex,
    attestationSlot: ssz.Slot,
  },
});

export const ProposerDuty = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    slot: ssz.Slot,
    proposerPubkey: ssz.BLSPubkey
  },
});

export const SyncingStatus = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    headSlot: ssz.Uint64,
    syncDistance: ssz.Uint64
  },
});

export const ValidatorResponse = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    index: ssz.ValidatorIndex,
    pubkey: ssz.BLSPubkey,
    balance: ssz.Gwei,
    validator: ssz.Validator
  },
});



export const Genesis = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    genesisValidatorsRoot: ssz.Root,
    genesisTime: ssz.Uint64,
    genesisForkVersion: ssz.Version
  },
});

