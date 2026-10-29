import {describe, expect, it} from "vitest";
import {EXECUTION_PROOF_TYPES} from "../../src/index.js";

describe("EXECUTION_PROOF_TYPES", () => {
  it("assigns proof types 1 through 7", () => {
    expect([...EXECUTION_PROOF_TYPES.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("pins a 32-byte verification key digest per proof type", () => {
    for (const [proofType, {verificationKeyDigest}] of EXECUTION_PROOF_TYPES) {
      expect(verificationKeyDigest, `digest of proof type ${proofType}`).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});
