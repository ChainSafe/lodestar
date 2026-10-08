import {eip8025} from "@lodestar/types";

/**
 * EIP-8025 `ProofEngine`: checks that `proofData` proves `publicInput` under the proof system
 * identified by `proofType`. Which proof types are supported depends on the verifiers available
 * to this node, not on the fork.
 */
export interface ProofEngine {
  readonly supportedProofTypes: ReadonlySet<eip8025.ProofType>;
  verifyExecutionProof(proof: eip8025.ExecutionProof): Promise<boolean>;
}
