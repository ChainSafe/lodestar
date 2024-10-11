import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

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

export type ExecutionPayload = ValueOf<typeof ssz.ExecutionPayload>;
export type ExecutionPayloadHeader = ValueOf<typeof ssz.ExecutionPayloadHeader>;
export type ExecutionRequests = ValueOf<typeof ssz.ExecutionRequests>;

export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;

export type BeaconState = ValueOf<typeof ssz.BeaconState>;

export type BlindedBeaconBlockBody = ValueOf<typeof ssz.BlindedBeaconBlockBody>;
export type BlindedBeaconBlock = ValueOf<typeof ssz.BlindedBeaconBlock>;
export type SignedBlindedBeaconBlock = ValueOf<typeof ssz.SignedBlindedBeaconBlock>;

export type BuilderBid = ValueOf<typeof ssz.BuilderBid>;
export type SignedBuilderBid = ValueOf<typeof ssz.SignedBuilderBid>;
export type SSEPayloadAttributes = ValueOf<typeof ssz.SSEPayloadAttributes>;

export type LightClientBootstrap = ValueOf<typeof ssz.LightClientBootstrap>;
export type LightClientUpdate = ValueOf<typeof ssz.LightClientUpdate>;
export type LightClientFinalityUpdate = ValueOf<typeof ssz.LightClientFinalityUpdate>;
export type LightClientOptimisticUpdate = ValueOf<typeof ssz.LightClientOptimisticUpdate>;
export type LightClientStore = ValueOf<typeof ssz.LightClientStore>;

export type PendingDeposit = ValueOf<typeof ssz.PendingDeposit>;
export type PendingPartialWithdrawal = ValueOf<typeof ssz.PendingPartialWithdrawal>;
export type PendingConsolidation = ValueOf<typeof ssz.PendingConsolidation>;

export type BlockContents = ValueOf<typeof ssz.BlockContents>;
export type SignedBlockContents = ValueOf<typeof ssz.SignedBlockContents>;
