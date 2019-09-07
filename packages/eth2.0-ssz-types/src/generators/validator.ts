/**
 * @module sszTypes/generators
 */

import {SimpleContainerType} from "@chainsafe/ssz";

import {IBeaconSSZTypes} from "../interface";

export const ValidatorDuty = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["validatorPubkey", ssz.BLSPubkey],
    ["committeeIndex", ssz.number64],
    ["attestationSlot", ssz.Slot],
    ["attestationShard", ssz.Shard],
    ["blockProductionSlot", ssz.Slot],
  ],
});

export const SyncingStatus = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["startingBlock", ssz.uint64],
    ["currentBlock", ssz.uint64],
    ["highestBlock", ssz.uint64],
  ],
});
