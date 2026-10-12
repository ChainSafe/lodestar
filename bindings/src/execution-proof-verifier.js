import bindings from "./bindings.js";

const executionProofVerifier = bindings.executionProofVerifier;

/** @type {typeof import("./execution-proof-verifier.d.ts").ZKVM_KIND} */
export const ZKVM_KIND = executionProofVerifier.ZkvmKind;

export const EXECUTION_PROOF_VERIFIER_AVAILABLE = executionProofVerifier.available;
export const EXECUTION_PROOF_MAX_SIZE = executionProofVerifier.MAX_PROOF_SIZE;

export const registerExecutionProofVerifier = executionProofVerifier.register;
export const hasExecutionProofVerifier = executionProofVerifier.has;

/** @type {typeof import("./execution-proof-verifier.d.ts").verifyExecutionProof} */
export async function verifyExecutionProof(proofType, proofData) {
  return executionProofVerifier.verify(proofType, proofData);
}
