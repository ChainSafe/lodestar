import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type Builder = ValueOf<typeof ssz.Builder>;
export type BuilderPendingWithdrawal = ValueOf<typeof ssz.BuilderPendingWithdrawal>;
export type BuilderPendingPayment = ValueOf<typeof ssz.BuilderPendingPayment>;
export type PayloadAttestationData = ValueOf<typeof ssz.PayloadAttestationData>;
export type PayloadAttestation = ValueOf<typeof ssz.PayloadAttestation>;
export type PayloadAttestationMessage = ValueOf<typeof ssz.PayloadAttestationMessage>;
export type IndexedPayloadAttestation = ValueOf<typeof ssz.IndexedPayloadAttestation>;
export type ProposerPreferences = ValueOf<typeof ssz.ProposerPreferences>;
export type SignedProposerPreferences = ValueOf<typeof ssz.SignedProposerPreferences>;
export type ExecutionPayloadBid = ValueOf<typeof ssz.ExecutionPayloadBid>;
export type SignedExecutionPayloadBid = ValueOf<typeof ssz.SignedExecutionPayloadBid>;
export type ExecutionPayloadEnvelope = ValueOf<typeof ssz.ExecutionPayloadEnvelope>;
export type SignedExecutionPayloadEnvelope = ValueOf<typeof ssz.SignedExecutionPayloadEnvelope>;
export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type BeaconState = ValueOf<typeof ssz.BeaconState>;

export type DataColumnSidecar = ValueOf<typeof ssz.DataColumnSidecar>;
export type DataColumnSidecars = ValueOf<typeof ssz.DataColumnSidecars>;
