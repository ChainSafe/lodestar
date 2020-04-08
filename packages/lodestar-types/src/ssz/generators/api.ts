import {IBeaconSSZTypes} from "../interface";
import {ContainerType} from "@chainsafe/ssz";

export const SubscribeToCommitteeSubnetPayload = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    slot: ssz.Slot,
    slotSignature: ssz.BLSSignature,
    committeeIndex: ssz.CommitteeIndex,
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