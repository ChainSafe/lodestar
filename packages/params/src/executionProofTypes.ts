/** Proof systems with a prebuilt ere verifier, keyed as in `ZKVM_KIND` of `@chainsafe/lodestar-z/execution-proof-verifier` */
export type ExecutionProofZkvm = "openvm" | "sp1" | "zisk";

export type ExecutionProofTypeAssignment = {
  statelessValidator: string;
  zkvm: ExecutionProofZkvm;
  zkvmVersion: string;
  /** SHA-256 of the raw verification key, 0x-prefixed lowercase hex */
  verificationKeyDigest: string;
};

/**
 * EIP-8025 proof type assignments. A proof type names one immutable combination of guest program,
 * proof system and version; the table is provisional but values MUST NOT be reused.
 * https://github.com/ethereum/consensus-specs/blob/ec37552e5dfcdbd430034de8811359a512c9aab0/specs/_features/eip8025/beacon-chain.md#proof-types
 */
export const EXECUTION_PROOF_TYPES: ReadonlyMap<number, ExecutionProofTypeAssignment> = new Map<
  number,
  ExecutionProofTypeAssignment
>([
  [
    1,
    {
      statelessValidator: "ethrex 26.0.0",
      zkvm: "openvm",
      zkvmVersion: "v2.1.0-preview",
      verificationKeyDigest: "0x5de0d2feff592e5957c2dfcb613b649751e623a8b28e68187250eaf000eed8d7",
    },
  ],
  [
    2,
    {
      statelessValidator: "ethrex 26.0.0",
      zkvm: "sp1",
      zkvmVersion: "v6.4.0",
      verificationKeyDigest: "0x5e614b666d4f9a60a68d826833b94e2c5afa029b2dc501a45f3656059811a4d7",
    },
  ],
  [
    3,
    {
      statelessValidator: "ethrex 26.0.0",
      zkvm: "zisk",
      zkvmVersion: "v1.1.0-alpha",
      verificationKeyDigest: "0x7f8d16136f2783e9eaef89365cbc34333d06a73f3b77313a72f94a2054e0347e",
    },
  ],
  [
    4,
    {
      statelessValidator: "reth 0.1.0-rc.3",
      zkvm: "openvm",
      zkvmVersion: "v2.1.0-preview",
      verificationKeyDigest: "0xc118d0744d722cef89896b7bd085bd957686b190f55deaed80147b9abe3dba59",
    },
  ],
  [
    5,
    {
      statelessValidator: "reth 0.1.0-rc.3",
      zkvm: "sp1",
      zkvmVersion: "v6.4.0",
      verificationKeyDigest: "0x420933f79a82fcb40880a97f0efb7780e6f939cbf6a0bbec716de24b8033df28",
    },
  ],
  [
    6,
    {
      statelessValidator: "reth 0.1.0-rc.3",
      zkvm: "zisk",
      zkvmVersion: "v1.1.0-alpha",
      verificationKeyDigest: "0x6806dfc26dfdab7aaa6931d832b78f052e08a151d36353bb8662dc54e6766756",
    },
  ],
  [
    7,
    {
      statelessValidator: "zesu tests-glamsterdam-devnet@v8.1.4",
      zkvm: "zisk",
      zkvmVersion: "v1.1.0-alpha",
      verificationKeyDigest: "0xad94ad82ad310fda4ab8e8e91e7b4826edaa20e9c4e76f479ed7ca3482e3755c",
    },
  ],
]);
