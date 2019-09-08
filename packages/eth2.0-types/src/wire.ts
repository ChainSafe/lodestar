import {
  Slot, Epoch, Hash, number64, Version, uint64,
} from "./primitive";
import {BeaconBlock} from "./block";

export type RequestId = string;

export type RequestBody =
  Hello |
  Goodbye |
  BeaconBlocksByRangeRequest |
  BeaconBlocksByRootRequest;

export type ResponseBody =
  Hello |
  Goodbye |
  BeaconBlocksByRangeResponse |
  BeaconBlocksByRootResponse;

export interface Hello {
  headForkVersion: Version;
  finalizedRoot: Hash;
  finalizedEpoch: Epoch;
  headRoot: Hash;
  headSlot: Slot;
}
export type Goodbye = uint64;

export interface BeaconBlocksByRangeRequest {
  headBlockRoot: Hash; 
  startSlot: Slot;
  count: number64;
  step: number64;
}
export type BeaconBlocksByRangeResponse = BeaconBlock[];

export type BeaconBlocksByRootRequest = Hash[];
export type BeaconBlocksByRootResponse = BeaconBlock[];
