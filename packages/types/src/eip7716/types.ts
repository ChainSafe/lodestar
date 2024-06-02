import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type BeaconState = ValueOf<typeof ssz.BeaconState>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type ExecutionPayload = ValueOf<typeof ssz.ExecutionPayload>;