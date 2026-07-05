import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type Builder = ValueOf<typeof ssz.Builder>;
export type BuilderPendingWithdrawal = ValueOf<typeof ssz.BuilderPendingWithdrawal>;
export type BuilderPendingPayment = ValueOf<typeof ssz.BuilderPendingPayment>;
export type BuilderDepositRequest = ValueOf<typeof ssz.BuilderDepositRequest>;
export type BuilderDepositRequests = ValueOf<typeof ssz.BuilderDepositRequests>;
export type BuilderExitRequest = ValueOf<typeof ssz.BuilderExitRequest>;
export type BuilderExitRequests = ValueOf<typeof ssz.BuilderExitRequests>;
export type ExecutionRequests = ValueOf<typeof ssz.ExecutionRequests>;
export type PayloadTimelinessCommittee = ValueOf<typeof ssz.PayloadTimelinessCommittee>;
export type PtcWindow = ValueOf<typeof ssz.PtcWindow>;
export type PayloadAttestationData = ValueOf<typeof ssz.PayloadAttestationData>;
export type PayloadAttestation = ValueOf<typeof ssz.PayloadAttestation>;
export type PayloadAttestationMessage = ValueOf<typeof ssz.PayloadAttestationMessage>;
export type IndexedPayloadAttestation = ValueOf<typeof ssz.IndexedPayloadAttestation>;
export type ProposerPreferences = ValueOf<typeof ssz.ProposerPreferences>;
export type SignedProposerPreferences = ValueOf<typeof ssz.SignedProposerPreferences>;
export type ExecutionPayload = ValueOf<typeof ssz.ExecutionPayload>;
export type ExecutionPayloadBid = ValueOf<typeof ssz.ExecutionPayloadBid>;
export type SignedExecutionPayloadBid = ValueOf<typeof ssz.SignedExecutionPayloadBid>;
export type BlockAccessList = ValueOf<typeof ssz.BlockAccessList>;
export type ExecutionPayloadEnvelope = ValueOf<typeof ssz.ExecutionPayloadEnvelope>;
export type SignedExecutionPayloadEnvelope = ValueOf<typeof ssz.SignedExecutionPayloadEnvelope>;
export type SignedExecutionPayloadEnvelopeContents = ValueOf<typeof ssz.SignedExecutionPayloadEnvelopeContents>;
export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type BlockContents = ValueOf<typeof ssz.BlockContents>;
export type BeaconState = ValueOf<typeof ssz.BeaconState>;

export type DataColumnSidecar = ValueOf<typeof ssz.DataColumnSidecar>;
export type DataColumnSidecars = ValueOf<typeof ssz.DataColumnSidecars>;

export type ExecutionPayloadEnvelopesByRangeRequest = ValueOf<typeof ssz.ExecutionPayloadEnvelopesByRangeRequest>;
export type PayloadAttributes = ValueOf<typeof ssz.PayloadAttributes>;
export type SSEPayloadAttributes = ValueOf<typeof ssz.SSEPayloadAttributes>;
