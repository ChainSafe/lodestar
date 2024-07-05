import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type ts = {
  Withdrawal: ValueOf<typeof ssz.Withdrawal>;
  Withdrawals: ValueOf<typeof ssz.Withdrawals>;
  BLSToExecutionChange: ValueOf<typeof ssz.BLSToExecutionChange>;
  BLSToExecutionChanges: ValueOf<typeof ssz.BLSToExecutionChanges>;
  SignedBLSToExecutionChange: ValueOf<typeof ssz.SignedBLSToExecutionChange>;

  ExecutionPayload: ValueOf<typeof ssz.ExecutionPayload>;
  ExecutionPayloadHeader: ValueOf<typeof ssz.ExecutionPayloadHeader>;

  BeaconBlockBody: ValueOf<typeof ssz.BeaconBlockBody>;
  BeaconBlock: ValueOf<typeof ssz.BeaconBlock>;
  SignedBeaconBlock: ValueOf<typeof ssz.SignedBeaconBlock>;
  BeaconState: ValueOf<typeof ssz.BeaconState>;

  BlindedBeaconBlockBody: ValueOf<typeof ssz.BlindedBeaconBlockBody>;
  BlindedBeaconBlock: ValueOf<typeof ssz.BlindedBeaconBlock>;
  SignedBlindedBeaconBlock: ValueOf<typeof ssz.SignedBlindedBeaconBlock>;

  FullOrBlindedExecutionPayload: ValueOf<typeof ssz.ExecutionPayload> | ValueOf<typeof ssz.ExecutionPayloadHeader>;

  BuilderBid: ValueOf<typeof ssz.BuilderBid>;
  SignedBuilderBid: ValueOf<typeof ssz.SignedBuilderBid>;
  SSEPayloadAttributes: ValueOf<typeof ssz.SSEPayloadAttributes>;

  LightClientHeader: ValueOf<typeof ssz.LightClientHeader>;
  LightClientBootstrap: ValueOf<typeof ssz.LightClientBootstrap>;
  LightClientUpdate: ValueOf<typeof ssz.LightClientUpdate>;
  LightClientFinalityUpdate: ValueOf<typeof ssz.LightClientFinalityUpdate>;
  LightClientOptimisticUpdate: ValueOf<typeof ssz.LightClientOptimisticUpdate>;
  LightClientStore: ValueOf<typeof ssz.LightClientStore>;
};
