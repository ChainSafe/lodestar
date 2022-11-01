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

export type BlindedBeaconBlockBody = ValueOf<typeof ssz.BlindedBeaconBlockBody>;
export type BlindedBeaconBlock = ValueOf<typeof ssz.BlindedBeaconBlock>;
export type SignedBlindedBeaconBlock = ValueOf<typeof ssz.SignedBlindedBeaconBlock>;

export type ValidatorRegistrationV1 = ValueOf<typeof ssz.ValidatorRegistrationV1>;
export type SignedValidatorRegistrationV1 = ValueOf<typeof ssz.SignedValidatorRegistrationV1>;
export type BuilderBid = ValueOf<typeof ssz.BuilderBid>;
export type SignedBuilderBid = ValueOf<typeof ssz.SignedBuilderBid>;

export type FullOrBlindedExecutionPayload = ExecutionPayload | ExecutionPayloadHeader;
