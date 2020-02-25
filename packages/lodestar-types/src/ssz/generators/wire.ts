/**
 * @module sszTypes/generators
 * */

import {ContainerType, BigIntUintType, ListType} from "@chainsafe/ssz";

import {IBeaconSSZTypes} from "../interface";

export const Status = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    headForkVersion: ssz.Version,
    finalizedRoot: ssz.Root,
    finalizedEpoch: ssz.Epoch,
    headRoot: ssz.Root,
    headSlot: ssz.Slot,
  },
});

export const Goodbye = (ssz: IBeaconSSZTypes): BigIntUintType => ssz.Uint64;

export const BeaconBlocksByRangeRequest = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    headBlockRoot: ssz.Root,
    startSlot: ssz.Slot,
    count: ssz.Number64,
    step: ssz.Number64,
  },
});

export const BeaconBlocksByRangeResponse = (ssz: IBeaconSSZTypes): ListType => new ListType({
  elementType: ssz.SignedBeaconBlock,
  limit: 32000,
});

export const BeaconBlocksByRootRequest = (ssz: IBeaconSSZTypes): ListType => new ListType({
  elementType: ssz.Root,
  limit: 32000,
});

export const BeaconBlocksByRootResponse = (ssz: IBeaconSSZTypes): ListType => new ListType({
  elementType: ssz.SignedBeaconBlock,
  limit: 32000,
});
