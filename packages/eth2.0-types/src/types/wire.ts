/* eslint-disable @typescript-eslint/interface-name-prefix */
import {
  Slot, Epoch, Root, number64, Version, uint64,
} from "./primitive";
import {BeaconBlock} from "./block";

export type RequestId = string;

export type RequestBody =
  Status |
  Goodbye |
  BeaconBlocksByRangeRequest |
  BeaconBlocksByRootRequest;

export type ResponseBody =
  Status |
  Goodbye |
  BeaconBlocksByRangeResponse |
  BeaconBlocksByRootResponse;

export interface Status {
  headForkVersion: Version;
  finalizedRoot: Root;
  finalizedEpoch: Epoch;
  headRoot: Root;
  headSlot: Slot;
}
export type Goodbye = uint64;

export interface BeaconBlocksByRangeRequest {
  headBlockRoot: Root; 
  startSlot: Slot;
  count: number64;
  step: number64;
}
export type BeaconBlocksByRangeResponse = BeaconBlock[];

export type BeaconBlocksByRootRequest = Root[];
export type BeaconBlocksByRootResponse = BeaconBlock[];
