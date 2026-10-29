import {ExecutionProofZkvm} from "@lodestar/params";
import {eip8025} from "@lodestar/types";
import {ExecutionProofInput} from "./executionProof.js";

/**
 * EIP-8025 `ProofEngine`: checks that `proofData` proves one of the accepted public inputs under the
 * proof system identified by `proofType`. Supported types are the spec assignments plus any explicit
 * ones this node was configured with; verifiable types are those it holds a verification key for.
 */
export interface ProofEngine {
  readonly supportedProofTypes: ReadonlySet<eip8025.ProofType>;
  readonly verifiableProofTypes: ReadonlySet<eip8025.ProofType>;
  verifyExecutionProof(input: ExecutionProofInput): Promise<boolean>;
}

/** Verification key for one EIP-8025 proof type */
export type ExecutionProofVerificationKey = {
  proofType: eip8025.ProofType;
  /** Hex-encoded raw verification key */
  verificationKey: string;
  /**
   * Set to assign the proof type explicitly instead of through the spec table, for a provisional
   * type the table lacks or a key the table's digest does not match yet. The key is then not checked.
   */
  zkvm?: ExecutionProofZkvm;
};
