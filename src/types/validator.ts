/**
 * @module types
 */

import {bytes48, Shard, Slot, uint64} from "./primitive";
import {SimpleContainerType} from "@chainsafe/ssz";

export interface ValidatorDuty {
  // The validator's public key, uniquely identifying them
  validatorPubkey: bytes48;
  // The index of the validator in the committee
  committeeIndex: uint64;
  // The slot at which the validator must attest
  attestationSlot: Slot;
  // The shard in which the validator must attest
  attestationShard: Shard;
  // The slot in which a validator must propose a block, this field can be Null
  blockProductionSlot: Slot;
}
export const ValidatorDuty: SimpleContainerType = {
  name: "ValidatorDuty",
  fields: [
    ["validatorPubkey", bytes48],
    ["committeeIndex", uint64],
    ["attestationSlot", Slot],
    ["attestationShard", Shard],
    ["blockProductionSlot", Slot],
  ],
};

export interface SyncingStatus {
  // The block at which syncing started (will only be reset, after the sync reached his head)
  startingBlock: uint64;
  // Current Block
  currentBlock: uint64;
  // The estimated highest block, or current target block number
  highestBlock: uint64;
}
export const SyncingStatus: SimpleContainerType = {
  name: "SyncingStatus",
  fields: [
    ["startingBlock", uint64],
    ["currentBlock", uint64],
    ["highestBlock", uint64],
  ],
};
