import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type InclusionListCommittee = ValueOf<typeof ssz.InclusionListCommittee>;
export type InclusionList = ValueOf<typeof ssz.InclusionList>;
export type SignedInclusionList = ValueOf<typeof ssz.SignedInclusionList>;
export type InclusionListByCommitteeIndicesRequest = ValueOf<typeof ssz.InclusionListByCommitteeIndicesRequest>;

export type ExecutionPayloadBid = ValueOf<typeof ssz.ExecutionPayloadBid>;
export type SignedExecutionPayloadBid = ValueOf<typeof ssz.SignedExecutionPayloadBid>;

export type BeaconState = ValueOf<typeof ssz.BeaconState>;
export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type SSEPayloadAttributes = ValueOf<typeof ssz.SSEPayloadAttributes>;
