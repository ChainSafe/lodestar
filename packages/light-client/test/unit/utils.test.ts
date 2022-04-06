import {expect} from "chai";
import {isValidMerkleBranch} from "../../src/utils/verifyMerkleBranch.js";
import {computeMerkleBranch} from "../utils.js";

describe("test utils", () => {
  it("constructMerkleBranch", () => {
    const leaf = Buffer.alloc(32, 0xdd);
    const depth = 5;
    const index = 22;
    const {root, proof} = computeMerkleBranch(leaf, depth, index);

    expect(isValidMerkleBranch(leaf, proof, depth, index, root)).to.equal(true);
  });
});
