import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type ts = {
  Transaction: ValueOf<typeof ssz.Transaction>;
  Transactions: ValueOf<typeof ssz.Transactions>;
  ExecutionPayload: ValueOf<typeof ssz.ExecutionPayload>;
  ExecutionPayloadHeader: ValueOf<typeof ssz.ExecutionPayloadHeader>;
  BeaconBlockBody: ValueOf<typeof ssz.BeaconBlockBody>;
  BeaconBlock: ValueOf<typeof ssz.BeaconBlock>;
  SignedBeaconBlock: ValueOf<typeof ssz.SignedBeaconBlock>;
  BeaconState: ValueOf<typeof ssz.BeaconState>;
  PowBlock: ValueOf<typeof ssz.PowBlock>;

  BlindedBeaconBlockBody: ValueOf<typeof ssz.BlindedBeaconBlockBody>;
  BlindedBeaconBlock: ValueOf<typeof ssz.BlindedBeaconBlock>;
  SignedBlindedBeaconBlock: ValueOf<typeof ssz.SignedBlindedBeaconBlock>;

  ValidatorRegistrationV1: ValueOf<typeof ssz.ValidatorRegistrationV1>;
  SignedValidatorRegistrationV1: ValueOf<typeof ssz.SignedValidatorRegistrationV1>;
  BuilderBid: ValueOf<typeof ssz.BuilderBid>;
  SignedBuilderBid: ValueOf<typeof ssz.SignedBuilderBid>;
  SSEPayloadAttributes: ValueOf<typeof ssz.SSEPayloadAttributes>;

  FullOrBlindedExecutionPayload: ValueOf<typeof ssz.ExecutionPayload> | ValueOf<typeof ssz.ExecutionPayloadHeader>;
};
