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