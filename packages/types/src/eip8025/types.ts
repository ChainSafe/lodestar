import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type ExecutionProofId = ValueOf<typeof ssz.ExecutionProofId>;
export type ExecutionProof = ValueOf<typeof ssz.ExecutionProof>;
export type ExecutionProofsByRootRequest = ValueOf<typeof ssz.ExecutionProofsByRootRequest>;
export type ExecutionProofsByRangeRequest = ValueOf<typeof ssz.ExecutionProofsByRangeRequest>;
