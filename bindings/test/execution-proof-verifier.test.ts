import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {beforeAll, describe, expect, it} from "vitest";
import {
  EXECUTION_PROOF_MAX_SIZE,
  EXECUTION_PROOF_VERIFIER_AVAILABLE,
  ZKVM_KIND,
  type ZkvmKindValue,
  hasExecutionProofVerifier,
  registerExecutionProofVerifier,
  verifyExecutionProof,
} from "../src/execution-proof-verifier.js";

/** Populated by `zig build run:download_ere_fixtures`; fixture tests skip when absent. */
const FIXTURE_DIR = join(import.meta.dirname, "../../test/fixtures/ere");

/** Eight zero KoalaBear words pack to a canonical SP1 verifying key. */
const SP1_ZERO_VK = new Uint8Array(32);

/** Registrations are process-wide, so every test here uses its own proof type. */
const PROOF_TYPE = {
  malformedVk: 201,
  openvm: 204,
  registerOnce: 207,
  registered: 202,
  sp1: 205,
  unknownKind: 200,
  unregistered: 203,
  zisk: 206,
} as const;

type Fixture = {kind: ZkvmKindValue; name: "openvm" | "sp1" | "zisk"};

const fixtures: Fixture[] = [
  {kind: ZKVM_KIND.openvm, name: "openvm"},
  {kind: ZKVM_KIND.sp1, name: "sp1"},
  {kind: ZKVM_KIND.zisk, name: "zisk"},
];

function readFixture(name: string, file: string): Uint8Array | null {
  const path = join(FIXTURE_DIR, name, file);
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}

describe.skipIf(!EXECUTION_PROOF_VERIFIER_AVAILABLE)("execution proof verifier", () => {
  beforeAll(() => {
    registerExecutionProofVerifier(PROOF_TYPE.registered, ZKVM_KIND.sp1, SP1_ZERO_VK);
  });

  it("rejects a proof type outside uint8", () => {
    expect(() => registerExecutionProofVerifier(256, ZKVM_KIND.sp1, SP1_ZERO_VK)).toThrow("InvalidProofType");
  });

  it("rejects an unknown zkvm kind", () => {
    expect(() => registerExecutionProofVerifier(PROOF_TYPE.unknownKind, 9 as ZkvmKindValue, SP1_ZERO_VK)).toThrow(
      "InvalidZkvmKind"
    );
  });

  it("rejects a malformed program verifying key", () => {
    expect(() =>
      registerExecutionProofVerifier(PROOF_TYPE.malformedVk, ZKVM_KIND.sp1, SP1_ZERO_VK.subarray(0, 31))
    ).toThrow("DecodeProgramVk");
    expect(hasExecutionProofVerifier(PROOF_TYPE.malformedVk)).toBe(false);
  });

  it("registers a verifier once per proof type", () => {
    expect(hasExecutionProofVerifier(PROOF_TYPE.registerOnce)).toBe(false);
    registerExecutionProofVerifier(PROOF_TYPE.registerOnce, ZKVM_KIND.sp1, SP1_ZERO_VK);
    expect(hasExecutionProofVerifier(PROOF_TYPE.registerOnce)).toBe(true);
    expect(() => registerExecutionProofVerifier(PROOF_TYPE.registerOnce, ZKVM_KIND.sp1, SP1_ZERO_VK)).toThrow(
      "ProofTypeAlreadyRegistered"
    );
  });

  it("rejects verification for an unregistered proof type", async () => {
    await expect(verifyExecutionProof(PROOF_TYPE.unregistered, new Uint8Array(1))).rejects.toThrow(
      "ProofTypeNotRegistered"
    );
  });

  it("rejects an oversized proof", async () => {
    await expect(
      verifyExecutionProof(PROOF_TYPE.registered, new Uint8Array(EXECUTION_PROOF_MAX_SIZE + 1))
    ).rejects.toThrow("ProofTooLarge");
  });

  it("resolves null for a malformed proof", async () => {
    await expect(
      verifyExecutionProof(PROOF_TYPE.registered, new TextEncoder().encode("not a proof"))
    ).resolves.toBeNull();
  });

  for (const fixture of fixtures) {
    const programVk = readFixture(fixture.name, "program_vk.bin");
    const proof = readFixture(fixture.name, "proof.bin");
    const publicValues = readFixture(fixture.name, "public_values.bin");
    const missing = programVk === null || proof === null || publicValues === null;

    it.skipIf(missing)(`verifies the ere ${fixture.name} fixture and rejects a flipped byte`, async () => {
      if (programVk === null || proof === null || publicValues === null) throw new Error("fixture missing");
      const proofType = PROOF_TYPE[fixture.name];
      registerExecutionProofVerifier(proofType, fixture.kind, programVk);

      await expect(verifyExecutionProof(proofType, proof)).resolves.toEqual(publicValues);

      const flipped = proof.slice();
      flipped[Math.floor(flipped.length / 2)] ^= 0x01;
      await expect(verifyExecutionProof(proofType, flipped)).resolves.toBeNull();
    });
  }
});
