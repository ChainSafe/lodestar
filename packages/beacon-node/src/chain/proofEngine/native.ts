import {digest} from "@chainsafe/as-sha256";
import {
  EXECUTION_PROOF_VERIFIER_AVAILABLE,
  ZKVM_KIND,
  registerExecutionProofVerifier,
  verifyExecutionProof,
} from "@chainsafe/lodestar-z/execution-proof-verifier";
import {EXECUTION_PROOF_TYPES, ExecutionProofZkvm} from "@lodestar/params";
import {eip8025, ssz} from "@lodestar/types";
import {LodestarError, fromHex, toHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {ExecutionProofVerificationKey, ProofEngine} from "./interface.js";

export class NativeProofEngine implements ProofEngine {
  readonly supportedProofTypes: ReadonlySet<eip8025.ProofType>;
  readonly verifiableProofTypes: ReadonlySet<eip8025.ProofType>;

  /** Each proof type can be registered only once per process. Failed registration does not roll back earlier keys. */
  constructor(
    keys: readonly ExecutionProofVerificationKey[],
    private readonly metrics: Metrics | null
  ) {
    if (!EXECUTION_PROOF_VERIFIER_AVAILABLE) {
      throw new LodestarError({code: "EXECUTION_PROOF_VERIFIER_UNAVAILABLE"});
    }
    for (const {proofType, verificationKey, zkvm} of keys) {
      const key = fromHex(verificationKey);
      registerExecutionProofVerifier(proofType, ZKVM_KIND[zkvm ?? assignedZkvm(proofType, key)], key);
    }
    this.verifiableProofTypes = new Set(keys.map((key) => key.proofType));
    this.supportedProofTypes = new Set([...EXECUTION_PROOF_TYPES.keys(), ...this.verifiableProofTypes]);
  }

  async verifyExecutionProof(proof: eip8025.ExecutionProof): Promise<boolean> {
    const {proofType} = proof;
    const timer = this.metrics?.executionProofEngine.verifyTime.startTimer({proofType});
    try {
      const result = await verifyNativeExecutionProof(
        proofType,
        proof.proofData,
        ssz.eip8025.PublicInput.serialize(proof.publicInput)
      );
      this.metrics?.executionProofEngine.verifyResult.inc({proofType, result});
      return result === "valid";
    } finally {
      timer?.();
    }
  }
}

function assignedZkvm(proofType: eip8025.ProofType, key: Uint8Array): ExecutionProofZkvm {
  const assignment = EXECUTION_PROOF_TYPES.get(proofType);
  if (assignment === undefined) {
    throw new LodestarError({code: "EXECUTION_PROOF_TYPE_UNASSIGNED", proofType});
  }
  const keyDigest = toHex(digest(key));
  if (keyDigest !== assignment.verificationKeyDigest) {
    throw new LodestarError({
      code: "EXECUTION_PROOF_VERIFICATION_KEY_MISMATCH",
      proofType,
      expected: assignment.verificationKeyDigest,
      actual: keyDigest,
    });
  }
  return assignment.zkvm;
}

export async function verifyNativeExecutionProof(
  proofType: eip8025.ProofType,
  proofData: eip8025.ProofData,
  expectedPublicInput: Uint8Array
): Promise<"valid" | "invalid_proof" | "public_input_mismatch"> {
  const publicValues = await verifyExecutionProof(proofType, proofData);
  return publicValues === null
    ? "invalid_proof"
    : matchesPublicInput(publicValues, expectedPublicInput)
      ? "valid"
      : "public_input_mismatch";
}

/** zkVM public values can pad the expected input with trailing zeros. */
export function matchesPublicInput(publicValues: Uint8Array, expectedPublicInput: Uint8Array): boolean {
  if (publicValues.length < expectedPublicInput.length) {
    return false;
  }
  for (let i = 0; i < expectedPublicInput.length; i++) {
    if (publicValues[i] !== expectedPublicInput[i]) {
      return false;
    }
  }
  for (let i = expectedPublicInput.length; i < publicValues.length; i++) {
    if (publicValues[i] !== 0) {
      return false;
    }
  }
  return true;
}
