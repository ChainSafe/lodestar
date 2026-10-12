import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterAll, describe, expect, it} from "vitest";
import {parseExecutionProofVerifierArg} from "../../../src/options/beaconNodeOptions/chain.js";

describe("options / beaconNodeOptions / chain.executionProofVerifiers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lodestar-eproof-"));
  const vkPath = path.join(dir, "sp1.vk");
  fs.writeFileSync(vkPath, Uint8Array.from([0xde, 0xad, 0xbe, 0xef]));

  afterAll(() => fs.rmSync(dir, {recursive: true, force: true}));

  it("parses <proofType>:<zkvm>:<programVkPath>", () => {
    expect(parseExecutionProofVerifierArg(`1:sp1:${vkPath}`)).toEqual({
      proofType: 1,
      zkvm: "sp1",
      programVk: "0xdeadbeef",
    });
  });

  it("rejects malformed values", () => {
    expect(() => parseExecutionProofVerifierArg(`256:sp1:${vkPath}`)).toThrow("expected <proofType 0-255>");
    expect(() => parseExecutionProofVerifierArg(`1:risc0:${vkPath}`)).toThrow("Unknown zkvm");
    expect(() => parseExecutionProofVerifierArg("1:sp1")).toThrow("expected <proofType 0-255>");
  });
});
