import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type AggregationBits = ValueOf<typeof ssz.AggregationBits>;
export type AttestingIndices = ValueOf<typeof ssz.AttestingIndices>;
export type Transaction = ValueOf<typeof ssz.Transaction>;
export type Transactions = ValueOf<typeof ssz.Transactions>;
export type Withdrawals = ValueOf<typeof ssz.Withdrawals>;
export type BlobKzgCommitments = ValueOf<typeof ssz.BlobKzgCommitments>;
export type KZGProofs = ValueOf<typeof ssz.KZGProofs>;
export type DataColumn = ValueOf<typeof ssz.DataColumn>;

export type Attestation = ValueOf<typeof ssz.Attestation>;
export type IndexedAttestation = ValueOf<typeof ssz.IndexedAttestation>;
export type IndexedAttestationBigint = ValueOf<typeof ssz.IndexedAttestationBigint>;
export type AttesterSlashing = ValueOf<typeof ssz.AttesterSlashing>;

export type AggregateAndProof = ValueOf<typeof ssz.AggregateAndProof>;
export type SignedAggregateAndProof = ValueOf<typeof ssz.SignedAggregateAndProof>;

export type DepositRequest = ValueOf<typeof ssz.DepositRequest>;
export type DepositRequests = ValueOf<typeof ssz.DepositRequests>;
export type WithdrawalRequest = ValueOf<typeof ssz.WithdrawalRequest>;
export type WithdrawalRequests = ValueOf<typeof ssz.WithdrawalRequests>;
export type ConsolidationRequest = ValueOf<typeof ssz.ConsolidationRequest>;
export type ConsolidationRequests = ValueOf<typeof ssz.ConsolidationRequests>;
export type ExecutionRequests = ValueOf<typeof ssz.ExecutionRequests>;

export type Builder = ValueOf<typeof ssz.Builder>;
export type BuilderPendingWithdrawal = ValueOf<typeof ssz.BuilderPendingWithdrawal>;
export type BuilderPendingPayment = ValueOf<typeof ssz.BuilderPendingPayment>;
export type BuilderDepositRequest = ValueOf<typeof ssz.BuilderDepositRequest>;
export type BuilderDepositRequests = ValueOf<typeof ssz.BuilderDepositRequests>;
export type BuilderExitRequest = ValueOf<typeof ssz.BuilderExitRequest>;
export type BuilderExitRequests = ValueOf<typeof ssz.BuilderExitRequests>;
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
export type BuilderRequestAuth = ValueOf<typeof ssz.BuilderRequestAuth>;
export type SignedBuilderRequestAuth = ValueOf<typeof ssz.SignedBuilderRequestAuth>;
export type BuilderPreferences = ValueOf<typeof ssz.BuilderPreferences>;
export type BuilderPreferencesRequest = ValueOf<typeof ssz.BuilderPreferencesRequest>;
export type BlockAccessList = ValueOf<typeof ssz.BlockAccessList>;
export type ExecutionPayloadEnvelope = ValueOf<typeof ssz.ExecutionPayloadEnvelope>;
export type SignedExecutionPayloadEnvelope = ValueOf<typeof ssz.SignedExecutionPayloadEnvelope>;
export type SignedExecutionPayloadEnvelopeContents = ValueOf<typeof ssz.SignedExecutionPayloadEnvelopeContents>;
export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type BlockContents = ValueOf<typeof ssz.BlockContents>;
export type LightClientHeader = ValueOf<typeof ssz.LightClientHeader>;
export type LightClientBootstrap = ValueOf<typeof ssz.LightClientBootstrap>;
export type LightClientUpdate = ValueOf<typeof ssz.LightClientUpdate>;
export type LightClientFinalityUpdate = ValueOf<typeof ssz.LightClientFinalityUpdate>;
export type LightClientOptimisticUpdate = ValueOf<typeof ssz.LightClientOptimisticUpdate>;
export type LightClientStore = ValueOf<typeof ssz.LightClientStore>;
export type BeaconState = ValueOf<typeof ssz.BeaconState>;

export type DataColumnSidecar = ValueOf<typeof ssz.DataColumnSidecar>;
export type DataColumnSidecars = ValueOf<typeof ssz.DataColumnSidecars>;

export type ExecutionPayloadEnvelopesByRangeRequest = ValueOf<typeof ssz.ExecutionPayloadEnvelopesByRangeRequest>;
export type PayloadAttributes = ValueOf<typeof ssz.PayloadAttributes>;
export type SSEPayloadAttributes = ValueOf<typeof ssz.SSEPayloadAttributes>;
