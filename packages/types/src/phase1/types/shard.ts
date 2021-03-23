import {List} from "@chainsafe/ssz";

import * as phase0 from "../../phase0";
import {Shard} from "./primitive";

export interface ShardBlock {
  shardParentRoot: phase0.Root;
  beaconParentRoot: phase0.Root;
  slot: phase0.Slot;
  shard: Shard;
  proposerIndex: phase0.ValidatorIndex;
  body: List<phase0.Uint8>;
}

export interface SignedShardBlock {
  message: ShardBlock;
  signature: phase0.BLSSignature;
}

export interface ShardBlockHeader {
  shardParentRoot: phase0.Root;
  beaconParentRoot: phase0.Root;
  slot: phase0.Slot;
  shard: Shard;
  proposerIndex: phase0.ValidatorIndex;
  bodyRoot: phase0.Root;
}

export interface ShardState {
  slot: phase0.Slot;
  gasprice: phase0.Gwei;
  latestBlockRoot: phase0.Root;
}

export interface ShardTransition {
  // Starting from slot
  startSlot: phase0.Slot;
  //Shard block lengths
  shardBlockLengths: List<phase0.Uint64>;
  // Shard data roots
  // The root is of ByteList[MAX_SHARD_BLOCK_SIZE]
  shardDataRoots: List<phase0.Bytes32>;
  // Intermediate shard states
  shardStates: List<ShardState>;
  // Proposer signature aggregate
  proposerSignatureAggregate: phase0.BLSSignature;
}

export interface CompactCommittee {
  pubkeys: List<phase0.BLSPubkey>;
  compactValidators: List<phase0.Uint64>;
}
