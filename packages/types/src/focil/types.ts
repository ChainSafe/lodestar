import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type InclusionList = ValueOf<typeof ssz.InclusionList>;
export type SignedInclusionList = ValueOf<typeof ssz.SignedInclusionList>;
export type InclusionListByCommitteeIndicesRequest = ValueOf<typeof ssz.InclusionListByCommitteeIndicesRequest>;

export type BeaconState = ValueOf<typeof ssz.BeaconState>;
export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type BlindedBeaconBlockBody = ValueOf<typeof ssz.BlindedBeaconBlockBody>;
export type SignedBlindedBeaconBlock = ValueOf<typeof ssz.SignedBlindedBeaconBlock>;
export type ExecutionPayload = ValueOf<typeof ssz.ExecutionPayload>;
export type ExecutionPayloadHeader = ValueOf<typeof ssz.ExecutionPayloadHeader>;
