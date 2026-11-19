/**
 * Mirrors `ere_verifier_new`'s discriminants.
 *
 * Source: https://github.com/eth-act/ere/blob/332d8b1206a85b111b4051d2f8e7162ed3b3bb33/bindings/c/src/lib.rs#L27-L32
 */
export declare const ZKVM_KIND: {
  readonly openvm: 0;
  readonly sp1: 1;
  readonly zisk: 2;
  readonly lambdavm: 3;
};

export type ZkvmKindValue = (typeof ZKVM_KIND)[keyof typeof ZKVM_KIND];

/** False on targets without a prebuilt ere verifier library; registration then throws. */
export declare const EXECUTION_PROOF_VERIFIER_AVAILABLE: boolean;

/**
 * EIP-8025 `MAX_PROOF_SIZE` in bytes.
 *
 * Spec: https://github.com/ethereum/consensus-specs/blob/a06852f7fad3d6c4557808f48ad7a32ed7cbf996/specs/_features/eip8025/beacon-chain.md#L74
 */
export declare const EXECUTION_PROOF_MAX_SIZE: 4194304;

/**
 * Binds `proofType` to an ere verifier for `zkvmKind` and `programVk`, once per process.
 * Throws when the proof type is already registered, the kind is unknown, or the key does not decode.
 */
export declare function registerExecutionProofVerifier(
  proofType: number,
  zkvmKind: ZkvmKindValue,
  programVk: Uint8Array
): void;

export declare function hasExecutionProofVerifier(proofType: number): boolean;

/**
 * Verifies `proofData` off the JS thread with the verifier registered for `proofType`.
 *
 * Resolves with the public values the proof commits to, or null when the proof is malformed or
 * does not verify.
 *
 * Rejects for an unregistered proof type, an oversized proof, or an internal
 * verifier failure.
 */
export declare function verifyExecutionProof(proofType: number, proofData: Uint8Array): Promise<Uint8Array | null>;
