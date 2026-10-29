import {existsSync, readFileSync} from "node:fs";
import {beforeAll, describe, expect, it} from "vitest";
import {EXECUTION_PROOF_VERIFIER_AVAILABLE} from "@chainsafe/lodestar-z/execution-proof-verifier";
import {EXECUTION_PROOF_TYPES} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {ExecutionProofVerificationKey} from "../../src/chain/proofEngine/interface.js";
import {NativeProofEngine} from "../../src/chain/proofEngine/native.js";

/** zkboost's proof type assignments for the ere-guests release the Sepolia provers run */
const sepoliaProofTypes = [
  {proofType: 1, zkvm: "openvm", guest: "ethrex-openvm-v2.1.0-preview"},
  {proofType: 2, zkvm: "sp1", guest: "ethrex-sp1-v6.9.0"},
  {proofType: 3, zkvm: "zisk", guest: "ethrex-zisk-v1.3.2-alpha"},
  {proofType: 4, zkvm: "openvm", guest: "reth-openvm-v2.1.0-preview"},
  {proofType: 5, zkvm: "sp1", guest: "reth-sp1-v6.9.0"},
  {proofType: 6, zkvm: "zisk", guest: "reth-zisk-v1.3.2-alpha"},
  {proofType: 8, zkvm: "sp1", guest: "nimbus-sp1-v6.9.0"},
  {proofType: 9, zkvm: "zisk", guest: "nimbus-zisk-v1.3.2-alpha"},
  {proofType: 10, zkvm: "sp1", guest: "nethermind-sp1-v6.9.0"},
  {proofType: 11, zkvm: "zisk", guest: "nethermind-zisk-v1.3.2-alpha"},
  {proofType: 12, zkvm: "sp1", guest: "zilkworm-sp1-v6.9.0"},
] as const;

describe.skipIf(!EXECUTION_PROOF_VERIFIER_AVAILABLE)("Sepolia execution proofs", () => {
  const fixtureDir = new URL("../fixtures/executionProofs/sepolia/", import.meta.url);
  let publicInput: ReturnType<typeof ssz.eip8025.PublicInput.deserialize>;
  let engine: NativeProofEngine;

  beforeAll(() => {
    const files = ["public_values.bin", ...sepoliaProofTypes.flatMap(({guest}) => [`${guest}.proof`, `${guest}.vk`])];
    for (const file of files) {
      expect(
        existsSync(new URL(file, fixtureDir)),
        `Missing sepolia/${file}. Run "pnpm download-execution-proofs-fixtures" before running native proof tests.`
      ).toBe(true);
    }
    publicInput = ssz.eip8025.PublicInput.deserialize(readFileSync(new URL("public_values.bin", fixtureDir)));
    const keys: ExecutionProofVerificationKey[] = sepoliaProofTypes.map(({proofType, zkvm, guest}) => ({
      proofType,
      zkvm,
      verificationKey: toHex(readFileSync(new URL(`${guest}.vk`, fixtureDir))),
    }));
    engine = new NativeProofEngine(keys, null);
  });

  it("treats the zkboost public values as a successful validation under the Amsterdam schema", () => {
    expect(publicInput.successfulValidation).toBe(true);
    expect(publicInput.schemaId).toBe(0x1501);
  });

  it("supports the spec types and the explicitly assigned Sepolia types", () => {
    expect([...engine.verifiableProofTypes]).toEqual(sepoliaProofTypes.map(({proofType}) => proofType));
    for (const proofType of EXECUTION_PROOF_TYPES.keys()) {
      expect(engine.supportedProofTypes.has(proofType), `spec proof type ${proofType}`).toBe(true);
    }
    expect(engine.supportedProofTypes.has(12)).toBe(true);
    expect(engine.supportedProofTypes.has(13)).toBe(false);
  });

  it.each(sepoliaProofTypes)("verifies the $guest proof as type $proofType", async ({proofType, guest}) => {
    const proofData = Uint8Array.from(readFileSync(new URL(`${guest}.proof`, fixtureDir)));

    await expect(engine.verifyExecutionProof({proofType, proofData, publicInput})).resolves.toBe(true);

    const otherChain = {...publicInput, chainId: publicInput.chainId + 1n};
    await expect(engine.verifyExecutionProof({proofType, proofData, publicInput: otherChain})).resolves.toBe(false);

    const corrupted = proofData.slice();
    corrupted[Math.floor(corrupted.length / 2)] ^= 1;
    await expect(engine.verifyExecutionProof({proofType, proofData: corrupted, publicInput})).resolves.toBe(false);
  });
});
