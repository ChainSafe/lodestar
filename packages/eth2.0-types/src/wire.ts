import {
  Slot, Epoch, Hash, number64, Version, uint64,
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
