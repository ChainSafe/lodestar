import {ValueOf} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import type {BlockContents} from "../types.js";
import * as ssz from "./sszTypes.js";

export type ts = {
  KZGProof: ValueOf<typeof ssz.KZGProof>;
  KZGCommitment: ValueOf<typeof ssz.KZGCommitment>;

  Blob: ValueOf<typeof ssz.Blob>;
  Blobs: ValueOf<typeof ssz.Blobs>;
  BlobSidecar: ValueOf<typeof ssz.BlobSidecar>;
  BlobSidecars: ValueOf<typeof ssz.BlobSidecars>;
  ExecutionPayloadAndBlobsBundle: ValueOf<typeof ssz.ExecutionPayloadAndBlobsBundle>;
  BlobsBundle: ValueOf<typeof ssz.BlobsBundle>;

  KzgCommitmentInclusionProof: ValueOf<typeof ssz.KzgCommitmentInclusionProof>;
  BlobKzgCommitments: ValueOf<typeof ssz.BlobKzgCommitments>;
  KZGProofs: ValueOf<typeof ssz.KZGProofs>;
  BLSFieldElement: ValueOf<typeof ssz.BLSFieldElement>;

  BlobIdentifier: ValueOf<typeof ssz.BlobIdentifier>;
  BlobSidecarsByRangeRequest: ValueOf<typeof ssz.BlobSidecarsByRangeRequest>;
  BlobSidecarsByRootRequest: ValueOf<typeof ssz.BlobSidecarsByRootRequest>;

  ExecutionPayload: ValueOf<typeof ssz.ExecutionPayload>;
  ExecutionPayloadHeader: ValueOf<typeof ssz.ExecutionPayloadHeader>;

  BeaconBlockBody: ValueOf<typeof ssz.BeaconBlockBody>;
  BeaconBlock: ValueOf<typeof ssz.BeaconBlock>;
  SignedBeaconBlock: ValueOf<typeof ssz.SignedBeaconBlock>;

  BeaconState: ValueOf<typeof ssz.BeaconState>;

  BlindedBeaconBlockBody: ValueOf<typeof ssz.BlindedBeaconBlockBody>;
  BlindedBeaconBlock: ValueOf<typeof ssz.BlindedBeaconBlock>;
  SignedBlindedBeaconBlock: ValueOf<typeof ssz.SignedBlindedBeaconBlock>;

  FullOrBlindedExecutionPayload: ValueOf<typeof ssz.ExecutionPayload> | ValueOf<typeof ssz.ExecutionPayloadHeader>;

  BuilderBid: ValueOf<typeof ssz.BuilderBid>;
  SignedBuilderBid: ValueOf<typeof ssz.SignedBuilderBid>;
  SSEPayloadAttributes: ValueOf<typeof ssz.SSEPayloadAttributes>;

  LightClientHeader: ValueOf<typeof ssz.LightClientHeader>;
  LightClientBootstrap: ValueOf<typeof ssz.LightClientBootstrap>;
  LightClientUpdate: ValueOf<typeof ssz.LightClientUpdate>;
  LightClientFinalityUpdate: ValueOf<typeof ssz.LightClientFinalityUpdate>;
  LightClientOptimisticUpdate: ValueOf<typeof ssz.LightClientOptimisticUpdate>;
  LightClientStore: ValueOf<typeof ssz.LightClientStore>;

  ProducedBlobSidecars: Omit<ValueOf<typeof ssz.BlobSidecars>, "signedBlockHeader" | "kzgCommitmentInclusionProof">;
  Contents: Omit<BlockContents<ForkName.deneb>, "block">;
};
