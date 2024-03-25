import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type InclusionListSummaryEntry = ValueOf<typeof ssz.InclusionListSummaryEntry>;
export type ILSummaryEntryList = ValueOf<typeof ssz.ILSummaryEntryList>;
export type ILTransactions = ValueOf<typeof ssz.ILTransactions>;
export type InclusionListSummary = ValueOf<typeof ssz.InclusionListSummary>;
export type SignedInclusionListSummary = ValueOf<typeof ssz.SignedInclusionListSummary>;
export type InclusionList = ValueOf<typeof ssz.InclusionList>;
export type SignedInclusionList = ValueOf<typeof ssz.SignedInclusionList>;

export type ExecutionPayload = ValueOf<typeof ssz.ExecutionPayload>;
export type ExecutionPayloadHeader = ValueOf<typeof ssz.ExecutionPayloadHeader>;

export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;

export type BlindedBeaconBlockBody = ValueOf<typeof ssz.BlindedBeaconBlockBody>;
export type BlindedBeaconBlock = ValueOf<typeof ssz.BlindedBeaconBlock>;
export type SignedBlindedBeaconBlock = ValueOf<typeof ssz.SignedBlindedBeaconBlock>;

export type BuilderBid = ValueOf<typeof ssz.BuilderBid>;
export type ExecutionPayloadAndBlobsBundle = ValueOf<typeof ssz.ExecutionPayloadAndBlobsBundle>;
export type SignedBuilderBid = ValueOf<typeof ssz.SignedBuilderBid>;

export type BeaconState = ValueOf<typeof ssz.BeaconState>;

export type LightClientHeader = ValueOf<typeof ssz.LightClientHeader>;
export type LightClientBootstrap = ValueOf<typeof ssz.LightClientBootstrap>;
export type LightClientUpdate = ValueOf<typeof ssz.LightClientUpdate>;
export type LightClientFinalityUpdate = ValueOf<typeof ssz.LightClientFinalityUpdate>;
export type LightClientOptimisticUpdate = ValueOf<typeof ssz.LightClientOptimisticUpdate>;
export type LightClientStore = ValueOf<typeof ssz.LightClientStore>;

export type SSEPayloadAttributes = ValueOf<typeof ssz.SSEPayloadAttributes>;
