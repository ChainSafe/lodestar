import {ExecutionProof} from "@lodestar/types";

export type VerifyExecutionProofsInput = {
  proofs: ExecutionProof[];
  minProofsRequired: number;
};

export type VerifyExecutionProofsResult = {ok: true; distinctProofTypes: number} | {ok: false; error: string};

export interface IZkvmExecutionProofVerifier {
  verifyProofs(input: VerifyExecutionProofsInput): VerifyExecutionProofsResult;
}

/**
 * Dummy zkEVM verifier for EIP-8025 proof-driven mode.
 *
 * This is intentionally basic for initial interop:
 * - At least min distinct proof types are present
 * - proofData is non-empty
 *
 * TODO EIP-8025: Replace with real zkVM proof verification
 */
export class DummyZkvmExecutionProofVerifier implements IZkvmExecutionProofVerifier {
  verifyProofs(input: VerifyExecutionProofsInput): VerifyExecutionProofsResult {
    const {proofs, minProofsRequired} = input;

    const distinctProofTypes = new Set<number>();

    for (const proof of proofs) {
      if (proof.proofData.length === 0) {
        return {ok: false, error: `empty proofData for proofType=${proof.proofType}`};
      }

      distinctProofTypes.add(proof.proofType);
    }

    if (distinctProofTypes.size < minProofsRequired) {
      return {
        ok: false,
        error: `insufficient distinct proof types: have=${distinctProofTypes.size} need=${minProofsRequired}`,
      };
    }

    return {ok: true, distinctProofTypes: distinctProofTypes.size};
  }
}

export const defaultZkvmExecutionProofVerifier: IZkvmExecutionProofVerifier = new DummyZkvmExecutionProofVerifier();
