import {List} from "@chainsafe/ssz";

import {Slot, Epoch, Root, Number64, Uint64, ForkDigest, Uint8} from "../../primitive/types";
import {SignedBeaconBlock} from "./block";
import {AttestationSubnets} from "./misc";

export type RequestId = string;

export interface ReqRespTypes {
  Status: {request: Status; response: Status};
  Goodbye: {request: Goodbye; response: Goodbye};
  Ping: {request: Ping; response: Ping};
  Metadata: {request: null; response: Metadata};
  BeaconBlocksByRange: {request: BeaconBlocksByRangeRequest; response: SignedBeaconBlock};
  BeaconBlocksByRoot: {request: BeaconBlocksByRootRequest; response: SignedBeaconBlock};
}

export type RequestBody = ReqRespTypes[keyof ReqRespTypes]["request"] | null;
export type ResponseBody = ReqRespTypes[keyof ReqRespTypes]["response"] | P2pErrorMessage;

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

export type P2pErrorMessage = List<Uint8>;
