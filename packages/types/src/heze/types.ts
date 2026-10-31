import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type InclusionListCommittee = ValueOf<typeof ssz.InclusionListCommittee>;
export type InclusionList = ValueOf<typeof ssz.InclusionList>;
export type SignedInclusionList = ValueOf<typeof ssz.SignedInclusionList>;
export type InclusionListsByIndicesRequest = ValueOf<typeof ssz.InclusionListsByIndicesRequest>;

export type ExecutionPayloadBid = ValueOf<typeof ssz.ExecutionPayloadBid>;
export type SignedExecutionPayloadBid = ValueOf<typeof ssz.SignedExecutionPayloadBid>;

export type SetSweepThresholdRequest = ValueOf<typeof ssz.SetSweepThresholdRequest>;
export type SweepThresholdRequests = ValueOf<typeof ssz.SweepThresholdRequests>;
export type ExecutionRequests = ValueOf<typeof ssz.ExecutionRequests>;
export type NewPayloadRequest = ValueOf<typeof ssz.NewPayloadRequest>;
export type ExecutionPayloadEnvelope = ValueOf<typeof ssz.ExecutionPayloadEnvelope>;
export type SignedExecutionPayloadEnvelope = ValueOf<typeof ssz.SignedExecutionPayloadEnvelope>;
export type ExecutionPayloadHeaderEnvelope = ValueOf<typeof ssz.ExecutionPayloadHeaderEnvelope>;
export type SignedExecutionPayloadHeaderEnvelope = ValueOf<typeof ssz.SignedExecutionPayloadHeaderEnvelope>;
export type SignedExecutionPayloadEnvelopeContents = ValueOf<typeof ssz.SignedExecutionPayloadEnvelopeContents>;

export type BeaconState = ValueOf<typeof ssz.BeaconState>;
export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type BlockContents = ValueOf<typeof ssz.BlockContents>;
export type SignedBlockContents = {signedBlock: SignedBeaconBlock};
export type SSEPayloadAttributes = ValueOf<typeof ssz.SSEPayloadAttributes>;
