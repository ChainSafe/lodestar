import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type KZGProof = ValueOf<typeof ssz.KZGProof>;
export type Blob = ValueOf<typeof ssz.Blob>;

export type Metadata = ValueOf<typeof ssz.Metadata>;
export type Status = ValueOf<typeof ssz.Status>;

export type Cell = ValueOf<typeof ssz.Cell>;
export type DataColumn = ValueOf<typeof ssz.DataColumn>;
export type ExtendedMatrix = ValueOf<typeof ssz.ExtendedMatrix>;
export type KzgCommitmentsInclusionProof = ValueOf<typeof ssz.KzgCommitmentsInclusionProof>;
export type DataColumnSidecar = ValueOf<typeof ssz.DataColumnSidecar>;
export type DataColumnSidecars = ValueOf<typeof ssz.DataColumnSidecars>;
export type MatrixEntry = ValueOf<typeof ssz.MatrixEntry>;

export type ProposerLookahead = ValueOf<typeof ssz.ProposerLookahead>;

export type DataColumnsByRootIdentifier = ValueOf<typeof ssz.DataColumnsByRootIdentifier>;
export type DataColumnSidecarsByRangeRequest = ValueOf<typeof ssz.DataColumnSidecarsByRangeRequest>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type BeaconState = ValueOf<typeof ssz.BeaconState>;
export type BlockContents = ValueOf<typeof ssz.BlockContents>;
export type SignedBlockContents = ValueOf<typeof ssz.SignedBlockContents>;
export type BlobsBundle = ValueOf<typeof ssz.BlobsBundle>;
export type BlobAndProofV2 = {
  blob: Blob;
  proofs: KZGProof[];
};
