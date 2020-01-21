/* eslint-disable @typescript-eslint/interface-name-prefix */
import {
  Slot, Epoch, Root, Number64, Uint64, Version,
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
export type Goodbye = Uint64;

export interface BeaconBlocksByRangeRequest {
  headBlockRoot: Root; 
  startSlot: Slot;
  count: Number64;
  step: Number64;
}
export type BeaconBlocksByRangeResponse = ArrayLike<BeaconBlock>;

export type BeaconBlocksByRootRequest = ArrayLike<Root>;
export type BeaconBlocksByRootResponse = ArrayLike<BeaconBlock>;
