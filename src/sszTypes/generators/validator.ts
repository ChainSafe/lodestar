/**
 * @module sszTypes/generators
 */

import {SimpleContainerType} from "@chainsafe/ssz";

import {BeaconSSZTypes} from "../interface";

export const ValidatorDuty = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "ValidatorDuty",
  fields: [
    ["validatorPubkey", ssz.bytes48],
    ["committeeIndex", ssz.number64],
    ["attestationSlot", ssz.Slot],
    ["attestationShard", ssz.Shard],
    ["blockProductionSlot", ssz.Slot],
  ],
});

export const SyncingStatus = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "SyncingStatus",
  fields: [
    ["startingBlock", ssz.uint64],
    ["currentBlock", ssz.uint64],
    ["highestBlock", ssz.uint64],
  ],
});
