import {eip8025, ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {ExecutionProofVerifierKey, ExecutionProofZkvm, ProofEngine} from "./interface.js";

/** The subset of `@chainsafe/lodestar-z/execution-proof-verifier` the engine uses */
export type ExecutionProofVerifier = {
  ZKVM_KIND: Record<ExecutionProofZkvm, number>;
  EXECUTION_PROOF_VERIFIER_AVAILABLE: boolean;
  registerExecutionProofVerifier(proofType: number, zkvmKind: number, programVk: Uint8Array): void;
  verifyExecutionProof(proofType: number, proofData: Uint8Array): Promise<Uint8Array | null>;
};

/**
 * `ProofEngine` over lodestar-z's ere verifier. Each configured proof type is bound to one zkVM and
 * guest program verifying key at construction; verification runs off the JS thread.
 */
export class NativeProofEngine implements ProofEngine {
  readonly supportedProofTypes: ReadonlySet<eip8025.ProofType>;

  constructor(
    private readonly verifier: ExecutionProofVerifier,
    keys: ExecutionProofVerifierKey[],
    private readonly metrics: Metrics | null
  ) {
    if (!verifier.EXECUTION_PROOF_VERIFIER_AVAILABLE) {
      throw Error("Execution proof verifier is not built for this platform");
    }
    for (const key of keys) {
      verifier.registerExecutionProofVerifier(key.proofType, verifier.ZKVM_KIND[key.zkvm], fromHex(key.programVk));
    }
    this.supportedProofTypes = new Set(keys.map((key) => key.proofType));
  }

  async verifyExecutionProof(proof: eip8025.ExecutionProof): Promise<boolean> {
    const {proofType} = proof;
    const timer = this.metrics?.executionProofEngine.verifyTime.startTimer({proofType});
    try {
      const publicValues = await this.verifier.verifyExecutionProof(proofType, proof.proofData);
      const result =
        publicValues === null
          ? "invalid_proof"
          : matchesPublicInput(publicValues, proof.publicInput)
            ? "valid"
            : "public_input_mismatch";
      this.metrics?.executionProofEngine.verifyResult.inc({proofType, result});
      return result === "valid";
    } finally {
      timer?.();
    }
  }
}

/**
 * The stateless-validator guests commit the SSZ serialization of `PublicInput` (43 bytes) as their public
 * values. OpenVM and ZisK pad the committed values to a fixed length, so bytes past the input must be zero.
 */
export function matchesPublicInput(publicValues: Uint8Array, publicInput: eip8025.PublicInput): boolean {
  const expected = ssz.eip8025.PublicInput.serialize(publicInput);
  if (publicValues.length < expected.length) {
    return false;
  }
  for (let i = 0; i < expected.length; i++) {
    if (publicValues[i] !== expected[i]) {
      return false;
    }
  }
  for (let i = expected.length; i < publicValues.length; i++) {
    if (publicValues[i] !== 0) {
      return false;
    }
  }
  return true;
}
