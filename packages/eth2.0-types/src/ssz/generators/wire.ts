/**
 * @module sszTypes/generators
 * */
import {SimpleContainerType, AnySSZType} from "@chainsafe/ssz-type-schema";

import {IBeaconSSZTypes} from "../interface";

export const Status = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["headForkVersion", ssz.Version],
    ["finalizedRoot", ssz.Root],
    ["finalizedEpoch", ssz.Epoch],
    ["headRoot", ssz.Root],
    ["headSlot", ssz.Slot],
  ],
});

export const Goodbye = (ssz: IBeaconSSZTypes): AnySSZType => ssz.uint64;

export const BeaconBlocksByRangeRequest = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["headBlockRoot", ssz.Root],
    ["startSlot", ssz.Slot],
    ["count", ssz.number64],
    ["step", ssz.number64],
  ],
});

export const BeaconBlocksByRangeResponse = (ssz: IBeaconSSZTypes): AnySSZType => ({
  elementType: ssz.SignedBeaconBlock,
  maxLength: 32000,
});

export const BeaconBlocksByRootRequest = (ssz: IBeaconSSZTypes): AnySSZType => ({
  elementType: ssz.Root,
  maxLength: 32000,
});

export const BeaconBlocksByRootResponse = (ssz: IBeaconSSZTypes): AnySSZType => ({
  elementType: ssz.SignedBeaconBlock,
  maxLength: 32000,
});
