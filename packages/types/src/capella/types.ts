import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type Withdrawal = ValueOf<typeof ssz.Withdrawal>;
export type BLSToExecutionChange = ValueOf<typeof ssz.BLSToExecutionChange>;
export type SignedBLSToExecutionChange = ValueOf<typeof ssz.SignedBLSToExecutionChange>;

export type ExecutionPayload = ValueOf<typeof ssz.ExecutionPayload>;
export type ExecutionPayloadHeader = ValueOf<typeof ssz.ExecutionPayloadHeader>;
export type Validator = ValueOf<typeof ssz.Validator>;
export type Validators = ValueOf<typeof ssz.Validators>;

export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type BeaconState = ValueOf<typeof ssz.BeaconState>;

export type BlindedBeaconBlockBody = ValueOf<typeof ssz.BlindedBeaconBlockBody>;
export type BlindedBeaconBlock = ValueOf<typeof ssz.BlindedBeaconBlock>;
export type SignedBlindedBeaconBlock = ValueOf<typeof ssz.SignedBlindedBeaconBlock>;
