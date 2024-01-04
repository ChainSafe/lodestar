import {ValueOf} from "@chainsafe/ssz";
import {BlockContents} from "../allForks/types.js";
import * as ssz from "./sszTypes.js";

export type KZGProof = ValueOf<typeof ssz.KZGProof>;
export type KZGCommitment = ValueOf<typeof ssz.KZGCommitment>;

export type Blob = ValueOf<typeof ssz.Blob>;
export type Blobs = ValueOf<typeof ssz.Blobs>;
export type BlobSidecar = ValueOf<typeof ssz.BlobSidecar>;
export type BlobSidecars = ValueOf<typeof ssz.BlobSidecars>;
export type ExecutionPayloadAndBlobsBundle = ValueOf<typeof ssz.ExecutionPayloadAndBlobsBundle>;
export type BlobsBundle = ValueOf<typeof ssz.BlobsBundle>;

export type KzgCommitmentInclusionProof = ValueOf<typeof ssz.KzgCommitmentInclusionProof>;
export type BlobKzgCommitments = ValueOf<typeof ssz.BlobKzgCommitments>;
export type KZGProofs = ValueOf<typeof ssz.KZGProofs>;
export type BLSFieldElement = ValueOf<typeof ssz.BLSFieldElement>;

export type BlobIdentifier = ValueOf<typeof ssz.BlobIdentifier>;
export type BlobSidecarsByRangeRequest = ValueOf<typeof ssz.BlobSidecarsByRangeRequest>;
export type BlobSidecarsByRootRequest = ValueOf<typeof ssz.BlobSidecarsByRootRequest>;

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

export type BuilderBid = ValueOf<typeof ssz.BuilderBid>;
export type SignedBuilderBid = ValueOf<typeof ssz.SignedBuilderBid>;
export type SSEPayloadAttributes = ValueOf<typeof ssz.SSEPayloadAttributes>;

export type LightClientHeader = ValueOf<typeof ssz.LightClientHeader>;
export type LightClientBootstrap = ValueOf<typeof ssz.LightClientBootstrap>;
export type LightClientUpdate = ValueOf<typeof ssz.LightClientUpdate>;
export type LightClientFinalityUpdate = ValueOf<typeof ssz.LightClientFinalityUpdate>;
export type LightClientOptimisticUpdate = ValueOf<typeof ssz.LightClientOptimisticUpdate>;
export type LightClientStore = ValueOf<typeof ssz.LightClientStore>;

export type ProducedBlobSidecars = Omit<BlobSidecars, "signedBlockHeader" | "kzgCommitmentInclusionProof">;
export type Contents = Omit<BlockContents, "block">;
