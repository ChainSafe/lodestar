import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type ExecutionPayloadHeader = ValueOf<typeof ssz.ExecutionPayloadHeader>;
export type BeaconState = ValueOf<typeof ssz.BeaconState>;
