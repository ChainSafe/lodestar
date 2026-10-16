import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type ProofData = ValueOf<typeof ssz.ProofData>;
export type ProofType = ValueOf<typeof ssz.ProofType>;
export type PublicInput = ValueOf<typeof ssz.PublicInput>;
export type ExecutionProof = ValueOf<typeof ssz.ExecutionProof>;
export type ExecutionProofEnvelope = ValueOf<typeof ssz.ExecutionProofEnvelope>;
export type SignedExecutionProofEnvelope = ValueOf<typeof ssz.SignedExecutionProofEnvelope>;
