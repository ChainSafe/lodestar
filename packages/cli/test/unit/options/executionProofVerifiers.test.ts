import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterAll, describe, expect, it} from "vitest";
import {parseExecutionProofVerifierArg} from "../../../src/options/beaconNodeOptions/chain.js";

describe("options / beaconNodeOptions / chain.executionProofVerifiers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lodestar-eproof-"));
  const vkPath = path.join(dir, "ethrex-sp1.vk");
  fs.writeFileSync(vkPath, Uint8Array.from([0xde, 0xad, 0xbe, 0xef]));

  afterAll(() => fs.rmSync(dir, {recursive: true, force: true}));

  it("parses <proofType>:<verificationKeyPath> for a spec-assigned type", () => {
    expect(parseExecutionProofVerifierArg(`2:${vkPath}`)).toEqual({
      proofType: 2,
      verificationKey: "0xdeadbeef",
    });
  });

  it("parses <proofType>:<zkvm>:<verificationKeyPath> as an explicit assignment", () => {
    expect(parseExecutionProofVerifierArg(`8:sp1:${vkPath}`)).toEqual({
      proofType: 8,
      verificationKey: "0xdeadbeef",
      zkvm: "sp1",
    });
    expect(parseExecutionProofVerifierArg(`2:zisk:${vkPath}`)).toEqual({
      proofType: 2,
      verificationKey: "0xdeadbeef",
      zkvm: "zisk",
    });
  });

  it("rejects malformed values", () => {
    expect(() => parseExecutionProofVerifierArg(`8:${vkPath}`)).toThrow("Proof type 8 has no spec assignment");
    expect(() => parseExecutionProofVerifierArg(`0:${vkPath}`)).toThrow("expected <proofType>");
    expect(() => parseExecutionProofVerifierArg(`256:sp1:${vkPath}`)).toThrow("expected <proofType>");
    expect(() => parseExecutionProofVerifierArg(`8:risc0:${vkPath}`)).toThrow("Proof type 8 has no spec assignment");
    expect(() => parseExecutionProofVerifierArg("2")).toThrow("expected <proofType>");
    expect(() => parseExecutionProofVerifierArg("2:sp1:")).toThrow("expected <proofType>");
  });
});
