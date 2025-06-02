import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type Metadata = ValueOf<typeof ssz.Metadata>;

export type Cell = ValueOf<typeof ssz.Cell>;
export type DataColumn = ValueOf<typeof ssz.DataColumn>;
export type ExtendedMatrix = ValueOf<typeof ssz.ExtendedMatrix>;
export type KzgCommitmentsInclusionProof = ValueOf<typeof ssz.KzgCommitmentsInclusionProof>;
export type DataColumnSidecar = ValueOf<typeof ssz.DataColumnSidecar>;
export type DataColumnSidecars = ValueOf<typeof ssz.DataColumnSidecars>;
export type MatrixEntry = ValueOf<typeof ssz.MatrixEntry>;

export type DataColumnIdentifier = ValueOf<typeof ssz.DataColumnIdentifier>;
export type DataColumnSidecarsByRootRequest = ValueOf<typeof ssz.DataColumnSidecarsByRootRequest>;
export type DataColumnSidecarsByRangeRequest = ValueOf<typeof ssz.DataColumnSidecarsByRangeRequest>;

export type BeaconState = ValueOf<typeof ssz.BeaconState>;
export type ProposerLookahead = ValueOf<typeof ssz.ProposerLookahead>;
