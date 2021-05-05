import {List} from "@chainsafe/ssz";

import {Slot, Epoch, Root, Number64, Uint64, ForkDigest} from "../../primitive/types";
import {AttestationSubnets} from "./misc";

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
