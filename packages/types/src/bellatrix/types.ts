import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type Transaction = ValueOf<typeof ssz.Transaction>;
export type ExecutionPayload = ValueOf<typeof ssz.ExecutionPayload>;
export type ExecutionPayloadHeader = ValueOf<typeof ssz.ExecutionPayloadHeader>;
export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type BeaconState = ValueOf<typeof ssz.BeaconState>;
export type PowBlock = ValueOf<typeof ssz.PowBlock>;
