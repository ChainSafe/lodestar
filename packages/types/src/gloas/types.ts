import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type BlockAccessList = ValueOf<typeof ssz.BlockAccessList>;
export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type BlindedBeaconBlock = ValueOf<typeof ssz.BlindedBeaconBlock>;
export type BlindedBeaconBlockBody = ValueOf<typeof ssz.BlindedBeaconBlockBody>;
export type BeaconState = ValueOf<typeof ssz.BeaconState>;
export type ExecutionPayload = ValueOf<typeof ssz.ExecutionPayload>;
export type ExecutionPayloadHeader = ValueOf<typeof ssz.ExecutionPayloadHeader>;
export type BlockContents = ValueOf<typeof ssz.BlockContents>;
export type SignedBlockContents = ValueOf<typeof ssz.SignedBlockContents>;
