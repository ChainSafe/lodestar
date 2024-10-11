import {describe, it, expect} from "vitest";
import {isValidMerkleBranch} from "../../src/utils/verifyMerkleBranch.js";
import {computeMerkleBranch} from "../utils/utils.js";
import {normalizeMerkleBranch} from "../../src/utils/normalizeMerkleBranch.js";
import {ZERO_HASH} from "../../src/spec/utils.js";

describe("utils", () => {
  it("constructMerkleBranch", () => {
    const leaf = Buffer.alloc(32, 0xdd);
    const depth = 5;
    const index = 22;
    const {root, proof} = computeMerkleBranch(leaf, depth, index);

    expect(isValidMerkleBranch(leaf, proof, depth, index, root)).toBe(true);
  });
  it("normalizeMerkleBranch", () => {
    const branch: Uint8Array[] = [];
    const branchDepth = 5;
    const newDepth = 7;

    for (let i = 0; i < branchDepth; i++) {
      branch.push(new Uint8Array(Array.from({length: 32}, () => i)));
    }

    const normalizedBranch = normalizeMerkleBranch(branch, newDepth);
    const expectedNormalizedBranch = [ZERO_HASH, ZERO_HASH, ...branch];

    expect(normalizedBranch).toEqual(expectedNormalizedBranch);
  });
});
