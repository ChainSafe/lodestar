import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type KZGProof = ValueOf<typeof ssz.KZGProof>;
export type KZGCommitment = ValueOf<typeof ssz.KZGCommitment>;
export type Blob = ValueOf<typeof ssz.Blob>;
export type Blobs = ValueOf<typeof ssz.Blobs>;
export type BlobsSidecar = ValueOf<typeof ssz.BlobsSidecar>;
export type BlobKzgCommitments = ValueOf<typeof ssz.BlobKzgCommitments>;
export type Polynomial = ValueOf<typeof ssz.Polynomial>;
export type PolynomialAndCommitment = ValueOf<typeof ssz.PolynomialAndCommitment>;
export type BLSFieldElement = ValueOf<typeof ssz.BLSFieldElement>;

export type BlobsSidecarsByRangeRequest = ValueOf<typeof ssz.BlobsSidecarsByRangeRequest>;
export type BeaconBlockAndBlobsSidecarByRootRequest = ValueOf<typeof ssz.BeaconBlockAndBlobsSidecarByRootRequest>;

export type ExecutionPayload = ValueOf<typeof ssz.ExecutionPayload>;
export type ExecutionPayloadHeader = ValueOf<typeof ssz.ExecutionPayloadHeader>;

export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type SignedBeaconBlockAndBlobsSidecar = ValueOf<typeof ssz.SignedBeaconBlockAndBlobsSidecar>;

export type BeaconState = ValueOf<typeof ssz.BeaconState>;

export type BlindedBeaconBlockBody = ValueOf<typeof ssz.BlindedBeaconBlockBody>;
export type BlindedBeaconBlock = ValueOf<typeof ssz.BlindedBeaconBlock>;
export type SignedBlindedBeaconBlock = ValueOf<typeof ssz.SignedBlindedBeaconBlock>;

export type FullOrBlindedExecutionPayload = ExecutionPayload | ExecutionPayloadHeader;

export type BuilderBid = ValueOf<typeof ssz.BuilderBid>;
export type SignedBuilderBid = ValueOf<typeof ssz.SignedBuilderBid>;

export type LightClientHeader = ValueOf<typeof ssz.LightClientHeader>;
export type LightClientBootstrap = ValueOf<typeof ssz.LightClientBootstrap>;
export type LightClientUpdate = ValueOf<typeof ssz.LightClientUpdate>;
export type LightClientFinalityUpdate = ValueOf<typeof ssz.LightClientFinalityUpdate>;
export type LightClientOptimisticUpdate = ValueOf<typeof ssz.LightClientOptimisticUpdate>;
export type LightClientStore = ValueOf<typeof ssz.LightClientStore>;
