import {eip8025} from "@lodestar/types";

/**
 * EIP-8025 `ProofEngine`: checks that `proofData` proves `publicInput` under the proof system
 * identified by `proofType`. The spec treats every assigned proof type as supported; which of
 * them this node can verify depends on the verification keys it was given.
 */
export interface ProofEngine {
  readonly verifiableProofTypes: ReadonlySet<eip8025.ProofType>;
  verifyExecutionProof(proof: eip8025.ExecutionProof): Promise<boolean>;
}

/** Verification key for one EIP-8025 proof type; the type fixes the guest program and zkVM */
export type ExecutionProofVerificationKey = {
  proofType: eip8025.ProofType;
  /** Hex-encoded raw verification key whose SHA-256 must match the proof type's assignment */
  verificationKey: string;
};
