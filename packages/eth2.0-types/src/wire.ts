import {
  Slot, bytes32, bytes, uint16, uint64,
  bytes8, Epoch, number64, Version, Hash,
} from "./primitive";
import {BeaconBlock} from "./block";

export type RequestId = string;

export type RequestBody =
  Hello |
  Goodbye |
  BeaconBlocksRequest |
  RecentBeaconBlocksRequest;

export type ResponseBody =
  Hello |
  Goodbye |
  BeaconBlocksResponse |
  RecentBeaconBlocksResponse;

export interface Hello {
  forkVersion: Version;
  finalizedRoot: Hash;
  finalizedEpoch: Epoch;
  headRoot: Hash;
  headSlot: Slot;
}

export interface Goodbye {
  reason: uint64;
}

export interface BeaconBlocksRequest {
  headBlockRoot: Hash; 
  startSlot: Slot;
  count: number64;
  step: number64;
}

export interface BeaconBlocksResponse {
  blocks: BeaconBlock[];
}

export interface RecentBeaconBlocksRequest {
  blockRoots: Hash[];
}

export interface RecentBeaconBlocksResponse {
  blocks: BeaconBlock[];
}
