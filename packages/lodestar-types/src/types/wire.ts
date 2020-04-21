/* eslint-disable @typescript-eslint/interface-name-prefix */
import {List} from "@chainsafe/ssz";

import {
  Slot, Epoch, Root, Number64, Uint64, ForkDigest,
} from "./primitive";
import {SignedBeaconBlock} from "./block";
import {AttestationSubnets} from "./misc";

export type RequestId = string;

export type RequestBody =
  Status |
  Goodbye |
  Ping |
  BeaconBlocksByRangeRequest |
  BeaconBlocksByRootRequest;

export type ResponseBody =
  Status |
  Goodbye |
  Ping |
  Metadata |
  SignedBeaconBlock;

export interface Status {
  forkDigest: ForkDigest;
  finalizedRoot: Root;
  finalizedEpoch: Epoch;
  headRoot: Root;
  headSlot: Slot;
}

export type Goodbye = Uint64;

export type Ping = Uint64;

export interface Metadata {
  seqNumber: Uint64;
  attnets: AttestationSubnets;
}

export interface BeaconBlocksByRangeRequest {
  startSlot: Slot;
  count: Number64;
  step: Number64;
}

export type BeaconBlocksByRootRequest = List<Root>;
