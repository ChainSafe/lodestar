import {ExecutionProof} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";

export type VerifyExecutionProofsInput = {
  proofs: ExecutionProof[];
  expectedBlockRootHex: string;
  expectedExecBlockHashHex: string;
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
 * - proof blockRoot matches expected beacon block root
 * - proof blockHash matches expected execution payload block hash
 */
export class DummyZkvmExecutionProofVerifier implements IZkvmExecutionProofVerifier {
  verifyProofs(input: VerifyExecutionProofsInput): VerifyExecutionProofsResult {
    const {proofs, expectedBlockRootHex, expectedExecBlockHashHex, minProofsRequired} = input;

    const distinctProofTypes = new Set<number>();

    for (const proof of proofs) {
      const proofBlockRootHex = toRootHex(proof.blockRoot);
      const proofExecBlockHashHex = toRootHex(proof.blockHash);

      if (proof.proofData.length === 0) {
        return {ok: false, error: `empty proofData for proofId=${proof.proofId}`};
      }

      if (proofBlockRootHex !== expectedBlockRootHex) {
        return {
          ok: false,
          error: `proof blockRoot mismatch: expected=${expectedBlockRootHex} got=${proofBlockRootHex}`,
        };
      }

      if (proofExecBlockHashHex !== expectedExecBlockHashHex) {
        return {
          ok: false,
          error: `proof blockHash mismatch: expected=${expectedExecBlockHashHex} got=${proofExecBlockHashHex}`,
        };
      }

      distinctProofTypes.add(proof.proofId);
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
