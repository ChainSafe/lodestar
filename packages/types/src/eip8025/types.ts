import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type ExecutionProofId = ValueOf<typeof ssz.ExecutionProofId>;
export type ProofType = ValueOf<typeof ssz.ProofType>;
export type PublicInput = ValueOf<typeof ssz.PublicInput>;
export type ExecutionProof = ValueOf<typeof ssz.ExecutionProof>;
export type SignedExecutionProof = ValueOf<typeof ssz.SignedExecutionProof>;
export type ExecutionProofsByRootRequest = ValueOf<typeof ssz.ExecutionProofsByRootRequest>;
export type ExecutionProofsByRangeRequest = ValueOf<typeof ssz.ExecutionProofsByRangeRequest>;
