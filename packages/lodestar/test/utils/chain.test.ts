import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import {checkLinearChainSegment} from "../../src/util/chain";
import {generateEmptySignedBlock} from "./block";

describe("checkLinearChainSegment", function () {
  it("should throw error if not enough block", () => {
    expect(() => checkLinearChainSegment(config, null)).to.throw("Not enough blocks to validate");
    expect(() => checkLinearChainSegment(config, [])).to.throw("Not enough blocks to validate");
    expect(() => checkLinearChainSegment(config, [generateEmptySignedBlock()])).to.throw(
      "Not enough blocks to validate"
    );
  });

  it("should throw error if first block not link to ancestor root", () => {
    const block = generateEmptySignedBlock();
    expect(() => checkLinearChainSegment(config, [block, block])).to.throw(
      "Block 0 does not link to parent 0xeade62f0457b2fdf48e7d3fc4b60736688286be7c7a3ac4c9a16a5e0600bd9e4"
    );
  });

  it("should throw error if second block not link to first block", () => {
    const firstBlock = generateEmptySignedBlock();
    const ancestorRoot = firstBlock.message.parentRoot;
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 1;
    // secondBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(firstBlock.message);
    expect(() => checkLinearChainSegment(config, [firstBlock, secondBlock], ancestorRoot)).to.throw(
      "Block 1 does not link to parent 0xeade62f0457b2fdf48e7d3fc4b60736688286be7c7a3ac4c9a16a5e0600bd9e4"
    );
  });

  it("should form linear chain segment", () => {
    const firstBlock = generateEmptySignedBlock();
    const ancestorRoot = firstBlock.message.parentRoot;
    const secondBlock = generateEmptySignedBlock();
    secondBlock.message.slot = 1;
    secondBlock.message.parentRoot = config.types.phase0.BeaconBlock.hashTreeRoot(firstBlock.message);
    checkLinearChainSegment(config, [firstBlock, secondBlock], ancestorRoot);
    // no error thrown means success
  });
});
