import {beforeEach, describe, it} from "mocha";
import {expect, assert} from "chai";
import {Number64} from "@chainsafe/lodestar-types";
import {BlockCache} from "../../../../src/eth1/impl/blocks";

type BlockTest = {
  timestamp: Number64;
  number: number;
};

describe("BlockCache", function() {
  let blockCache: BlockCache<BlockTest>;
  beforeEach(function () {
    blockCache = new BlockCache<BlockTest>();
    blockCache.init([
      {timestamp: 2000, number: 100},
      {timestamp: 3000, number: 101}
    ], {timestamp: 100000, number: 1000})
  });

  it("should has block 100", () => {
    expect(blockCache.hasBlock({timestamp: 2000, number: 100})).to.be.true;
    expect(blockCache.hasBlock({timestamp: 2000, number: 500})).to.be.false;
  });

  it("should find block by timestamp", () => {
    expect(blockCache.findBlocksByTimestamp().length).to.be.equal(2);
    expect(blockCache.findBlocksByTimestamp(2500, 3500).length).to.be.equal(1);
    expect(blockCache.findBlocksByTimestamp(1500, 2500).length).to.be.equal(1);
  });

  it("should add block", () => {
    const newBlock =  {timestamp: 2002, number: 102};
    blockCache.addBlock(newBlock);
    const blocks = blockCache.findBlocksByTimestamp();
    expect(blocks.length).to.be.equal(3);
    assert.deepEqual(blocks[2], newBlock);
  });

  it("should replace block", () => {
    const newBlock =  {timestamp: 2002, number: 101};
    blockCache.addBlock(newBlock);
    const blocks = blockCache.findBlocksByTimestamp();
    expect(blocks.length).to.be.equal(2);
    assert.deepEqual(blocks[1], newBlock);
  });

  it("should prune blocks", () => {
    blockCache.prune(2500);
    const blocks = blockCache.findBlocksByTimestamp();
    expect(blocks.length).to.be.equal(1);
    assert.deepEqual(blocks[0], {timestamp: 3000, number: 101});
  });

  it("should not prune blocks", () => {
    blockCache.prune(1000);
    const blocks = blockCache.findBlocksByTimestamp();
    expect(blocks.length).to.be.equal(2);
    assert.deepEqual(blocks[1], {timestamp: 3000, number: 101});
  });

  it("should clear blocks thru prune", () => {
    blockCache.prune(4000);
    const blocks = blockCache.findBlocksByTimestamp();
    expect(blocks.length).to.be.equal(0);
  });

  it("should request new block", () => {
    const head = {timestamp: 110000, number: 1001};
    const number = blockCache.requestNewBlock(head);
    expect(number).to.be.equal(102);
  });

  it("should not request new block if reorg", () => {
    const head = {timestamp: 99999, number: 999};
    const number = blockCache.requestNewBlock(head);
    expect(number).to.be.undefined;
  });
});