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

  it("parses <proofType>:<verificationKeyPath>", () => {
    expect(parseExecutionProofVerifierArg(`2:${vkPath}`)).toEqual({
      proofType: 2,
      verificationKey: "0xdeadbeef",
    });
  });

  it("rejects malformed values", () => {
    expect(() => parseExecutionProofVerifierArg(`8:${vkPath}`)).toThrow("expected <proofType 1|2|3|4|5|6|7>");
    expect(() => parseExecutionProofVerifierArg(`0:${vkPath}`)).toThrow("expected <proofType 1|2|3|4|5|6|7>");
    expect(() => parseExecutionProofVerifierArg("2")).toThrow("expected <proofType 1|2|3|4|5|6|7>");
    expect(() => parseExecutionProofVerifierArg("2:")).toThrow("expected <proofType 1|2|3|4|5|6|7>");
  });
});
