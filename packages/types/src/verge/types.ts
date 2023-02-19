import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type Bytes31 = ValueOf<typeof ssz.Bytes31>;
export type BanderwagonGroupElement = ValueOf<typeof ssz.BanderwagonGroupElement>;
export type BanderwagonFieldElement = ValueOf<typeof ssz.BanderwagonFieldElement>;
export type Stem = ValueOf<typeof ssz.Stem>;

export type SuffixStateDiff = ValueOf<typeof ssz.SuffixStateDiff>;
export type StemStateDiff = ValueOf<typeof ssz.StemStateDiff>;
export type StateDiff = ValueOf<typeof ssz.StateDiff>;
export type IpaProof = ValueOf<typeof ssz.IpaProof>;
export type VerkleProof = ValueOf<typeof ssz.VerkleProof>;
export type ExecutionWitness = ValueOf<typeof ssz.ExecutionWitness>;

export type ExecutionPayload = ValueOf<typeof ssz.ExecutionPayload>;
export type ExecutionPayloadHeader = ValueOf<typeof ssz.ExecutionPayloadHeader>;

export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;

export type BeaconState = ValueOf<typeof ssz.BeaconState>;

export type BlindedBeaconBlockBody = ValueOf<typeof ssz.BlindedBeaconBlockBody>;
export type BlindedBeaconBlock = ValueOf<typeof ssz.BlindedBeaconBlock>;
export type SignedBlindedBeaconBlock = ValueOf<typeof ssz.SignedBlindedBeaconBlock>;

export type FullOrBlindedExecutionPayload = ExecutionPayload | ExecutionPayloadHeader;
