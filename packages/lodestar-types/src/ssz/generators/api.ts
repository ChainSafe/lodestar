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
    startingBlock: ssz.Uint64,
    currentBlock: ssz.Uint64,
    highestBlock: ssz.Uint64,
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

export const HeadResponse = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    headSlot: ssz.Slot,
    headBlockRoot: ssz.Root,
    finalizedSlot: ssz.Slot,
    finalizedBlockRoot: ssz.Root,
    justifiedSlot: ssz.Slot,
    justifiedBlockRoot: ssz.Root
  },
});
