/**
 * @module sszTypes/generators
 * */
import {SimpleContainerType} from "@chainsafe/ssz";

import {IBeaconSSZTypes} from "../interface";

export const Hello = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["forkVersion", ssz.Version],
    ["finalizedRoot", ssz.Hash],
    ["finalizedEpoch", ssz.Epoch],
    ["headRoot", ssz.Hash],
    ["headSlot", ssz.Slot],
  ],
});

export const Goodbye = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["reason", ssz.uint64],
  ],
});

export const BeaconBlocksRequest = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["headBlockRoot", ssz.Hash],
    ["startSlot", ssz.Slot],
    ["count", ssz.number64],
    ["step", ssz.number64],
  ],
});

export const BeaconBlocksResponse = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["blocks", {
      elementType: ssz.BeaconBlock,
      maxLength: 32000,
    }],
  ],
});

export const RecentBeaconBlocksRequest = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["blockRoots", {
      elementType: ssz.Hash,
      maxLength: 32000,
    }],
  ],
});

export const RecentBeaconBlocksResponse = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["blocks", {
      elementType: ssz.BeaconBlock,
      maxLength: 32000,
    }],
  ],
});
