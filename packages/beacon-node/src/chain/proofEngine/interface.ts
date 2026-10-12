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

/** zkVMs with a prebuilt ere verifier, mirrors `ZKVM_KIND` in `@chainsafe/lodestar-z/execution-proof-verifier` */
export const EXECUTION_PROOF_ZKVMS = ["openvm", "sp1", "zisk", "lambdavm"] as const;
export type ExecutionProofZkvm = (typeof EXECUTION_PROOF_ZKVMS)[number];

/** Binds an EIP-8025 proof type to the zkVM and guest program verifying key that proves it */
export type ExecutionProofVerifierKey = {
  proofType: eip8025.ProofType;
  zkvm: ExecutionProofZkvm;
  /** Hex-encoded program verifying key, as exported by the zkVM toolchain */
  programVk: string;
};
