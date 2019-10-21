import {describe, it} from "mocha";
import {IReputation} from "../../../../src/sync/IReputation";
import {BeaconBlock, BeaconBlockHeader, Epoch} from "@chainsafe/eth2.0-types";
import {chunkify, getTargetEpoch, isValidHeaderChain} from "../../../../src/sync/utils/sync";
import {expect} from "chai";
import {generateEmptyBlock} from "../../../utils/block";
import {hashTreeRoot} from "@chainsafe/ssz";
import {config} from "@chainsafe/eth2.0-config/src/presets/minimal";
import {blockToHeader} from "../../../../src/chain/stateTransition/util";

describe("sync utils", function () {
   
  describe("get initial sync target epoch", function () {
    it("should obtain target epoch", function () {
      const peers: IReputation[] = [
        generateReputation(3),
        generateReputation(1),
        generateReputation(2),
      ];
      const result = getTargetEpoch(peers, {epoch: 0, root: Buffer.alloc(0)});
      expect(result).to.be.equal(1);
      const result1 = getTargetEpoch(peers, {epoch: 2, root: Buffer.alloc(0)});
      expect(result1).to.be.equal(3);
      const result2 = getTargetEpoch(peers, {epoch: 3, root: Buffer.alloc(0)});
      expect(result2).to.be.equal(3);
    });

    it("should obtain target epoch with incomplete hello statuses", function () {
      const peers: IReputation[] = [
        {
          latestHello: null,
          score: 1
        },
        generateReputation(1),
        generateReputation(2),
      ];
      const result = getTargetEpoch(peers, {epoch: 0, root: Buffer.alloc(0)});
      expect(result).to.be.equal(1);
    });

    it("should return given epoch if no peers", function () {
      const peers: IReputation[] = [
      ];
      const result = getTargetEpoch(peers, {epoch: 0, root: Buffer.alloc(0)});
      expect(result).to.be.equal(0);
    });
  });

  describe("Chunkify block range", function () {
    it("should return chunks of block range", function () {
      const result = chunkify(10, 0, 30);
      expect(result.length).to.be.equal(3);
      expect(result[0].start).to.be.equal(1);
      expect(result[0].end).to.be.equal(10);
      expect(result[1].start).to.be.equal(11);
      expect(result[1].end).to.be.equal(20);
      expect(result[2].start).to.be.equal(21);
      expect(result[2].end).to.be.equal(30);
    });

    it("should return chunks of block range - not rounded", function () {
      const result = chunkify(10, 0, 25);
      expect(result.length).to.be.equal(3);
      expect(result[2].start).to.be.equal(21);
      expect(result[2].end).to.be.equal(25);
    });
  });

  describe("verify header chain", function () {

    it("Should verify correct chain of blocks", function () {
      const startHeader = blockToHeader(config, generateEmptyBlock());
      const blocks = generateValidChain(startHeader);
      const result = isValidHeaderChain(config, startHeader, blocks);
      expect(result).to.be.true;
    });

    it("Should verify invalid chain of blocks - different start header", function () {
      const startHeader = blockToHeader(config, generateEmptyBlock());
      const blocks = generateValidChain(startHeader);
      startHeader.slot = 99;
      const result = isValidHeaderChain(config, startHeader, blocks);
      expect(result).to.be.false;
    });

    it("Should verify invalid chain of blocks - invalid middle root", function () {
      const startHeader = blockToHeader(config, generateEmptyBlock());
      const blocks = generateValidChain(startHeader);
      blocks[1].parentRoot = Buffer.alloc(32);
      const result = isValidHeaderChain(config, startHeader, blocks);
      expect(result).to.be.false;
    });
  });
    
});

function generateValidChain(start: BeaconBlockHeader, n = 3): BeaconBlock[] {
  const blocks = [];
  let parentRoot = hashTreeRoot(start, config.types.BeaconBlockHeader);
  for(let i = 0; i < n; i++) {
    const block = generateEmptyBlock();
    block.parentRoot = parentRoot;
    block.slot = i;
    parentRoot = hashTreeRoot(blockToHeader(config, block), config.types.BeaconBlockHeader);
    blocks.push(block);
  }
  return blocks;
}

function generateReputation(finalizedEpoch: Epoch): IReputation {
  return {
    score: 1,
    latestHello: {
      finalizedEpoch: finalizedEpoch || 0,
      finalizedRoot: Buffer.alloc(1),
      headForkVersion: Buffer.alloc(4),
      headRoot: Buffer.alloc(1),
      headSlot: 0
    }
  };
}