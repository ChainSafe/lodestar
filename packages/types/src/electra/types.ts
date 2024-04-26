import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type Attestation = ValueOf<typeof ssz.Attestation>;
export type IndexedAttestation = ValueOf<typeof ssz.IndexedAttestation>;
export type IndexedAttestationBigint = ValueOf<typeof ssz.IndexedAttestationBigint>;
export type AttesterSlashing = ValueOf<typeof ssz.AttesterSlashing>;

export type AggregateAndProof = ValueOf<typeof ssz.AggregateAndProof>;
export type SignedAggregateAndProof = ValueOf<typeof ssz.SignedAggregateAndProof>;

export type DepositReceipt = ValueOf<typeof ssz.DepositReceipt>;
export type DepositReceipts = ValueOf<typeof ssz.DepositReceipts>;

export type ExecutionLayerWithdrawalRequest = ValueOf<typeof ssz.ExecutionLayerWithdrawalRequest>;
export type ExecutionLayerWithdrawalRequests = ValueOf<typeof ssz.ExecutionLayerWithdrawalRequests>;

export type ExecutionPayload = ValueOf<typeof ssz.ExecutionPayload>;
export type ExecutionPayloadHeader = ValueOf<typeof ssz.ExecutionPayloadHeader>;

export type ExecutionPayloadAndBlobsBundle = ValueOf<typeof ssz.ExecutionPayloadAndBlobsBundle>;

export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;

export type BeaconState = ValueOf<typeof ssz.BeaconState>;

export type BlindedBeaconBlockBody = ValueOf<typeof ssz.BlindedBeaconBlockBody>;
export type BlindedBeaconBlock = ValueOf<typeof ssz.BlindedBeaconBlock>;
export type SignedBlindedBeaconBlock = ValueOf<typeof ssz.SignedBlindedBeaconBlock>;

export type FullOrBlindedExecutionPayload = ExecutionPayload | ExecutionPayloadHeader;

export type BuilderBid = ValueOf<typeof ssz.BuilderBid>;
export type SignedBuilderBid = ValueOf<typeof ssz.SignedBuilderBid>;
export type SSEPayloadAttributes = ValueOf<typeof ssz.SSEPayloadAttributes>;

export type LightClientHeader = ValueOf<typeof ssz.LightClientHeader>;
export type LightClientBootstrap = ValueOf<typeof ssz.LightClientBootstrap>;
export type LightClientUpdate = ValueOf<typeof ssz.LightClientUpdate>;
export type LightClientFinalityUpdate = ValueOf<typeof ssz.LightClientFinalityUpdate>;
export type LightClientOptimisticUpdate = ValueOf<typeof ssz.LightClientOptimisticUpdate>;
export type LightClientStore = ValueOf<typeof ssz.LightClientStore>;

export type Consolidation = ValueOf<typeof ssz.Consolidation>;
export type SignedConsolidation = ValueOf<typeof ssz.SignedConsolidation>;

export type PendingBalanceDeposit = ValueOf<typeof ssz.PendingBalanceDeposit>;
export type PartialWithdrawal = ValueOf<typeof ssz.PartialWithdrawal>;
export type PendingConsolidation = ValueOf<typeof ssz.PendingConsolidation>;