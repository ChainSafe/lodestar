import {describe, it} from "mocha";
import {IReputation, ReputationStore} from "../../../../src/sync/IReputation";
import {BeaconBlockHeader, Epoch, SignedBeaconBlock, Status, BeaconState} from "@chainsafe/lodestar-types";
import {
  chunkify,
  getBlockRangeFromPeer,
  getInitalSyncTargetEpoch,
  isValidChainOfBlocks,
  isValidFinalizedCheckPoint,
  isValidPeerForInitSync
} from "../../../../src/sync/utils/sync";
import {expect} from "chai";
import {generateEmptyBlock, generateEmptySignedBlock} from "../../../utils/block";
import {config} from "@chainsafe/lodestar-config/src/presets/minimal";
import {blockToHeader} from "@chainsafe/lodestar-beacon-state-transition";
import sinon from "sinon";
import {ReqResp} from "../../../../src/network/reqResp";
import PeerId from "peer-id";
import PeerInfo from "peer-info";
import {generateState} from "../../../utils/state";

describe("sync utils", function () {
   
  describe("get initial sync target epoch", function () {
    it("should obtain target epoch", function () {
      const peers: IReputation[] = [
        generateReputation(3),
        generateReputation(1),
        generateReputation(2),
      ];
      const result = getInitalSyncTargetEpoch(peers, {epoch: 0, root: Buffer.alloc(0)});
      expect(result).to.be.equal(1);
      const result1 = getInitalSyncTargetEpoch(peers, {epoch: 2, root: Buffer.alloc(0)});
      expect(result1).to.be.equal(3);
      const result2 = getInitalSyncTargetEpoch(peers, {epoch: 3, root: Buffer.alloc(0)});
      expect(result2).to.be.equal(3);
    });

    it("should obtain target epoch with incomplete hello statuses", function () {
      const peers: IReputation[] = [
        {
          latestStatus: null,
          latestMetadata: null,
          score: 1
        },
        generateReputation(1),
        generateReputation(2),
      ];
      const result = getInitalSyncTargetEpoch(peers, {epoch: 0, root: Buffer.alloc(0)});
      expect(result).to.be.equal(1);
    });

    it("should return given epoch if no peers", function () {
      const peers: IReputation[] = [
      ];
      const result = getInitalSyncTargetEpoch(peers, {epoch: 0, root: Buffer.alloc(0)});
      expect(result).to.be.equal(0);
    });
  });

  describe("Chunkify block range", function () {
    it("should return chunks of block range", function () {
      const result = chunkify(10, 0, 30);
      expect(result.length).to.be.equal(3);
      expect(result[0].start).to.be.equal(0);
      expect(result[0].end).to.be.equal(9);
      expect(result[1].start).to.be.equal(10);
      expect(result[1].end).to.be.equal(19);
      expect(result[2].start).to.be.equal(20);
      expect(result[2].end).to.be.equal(29);
    });

    it("should return chunks of block range - not rounded", function () {
      const result = chunkify(10, 0, 25);
      expect(result.length).to.be.equal(3);
      expect(result[2].start).to.be.equal(20);
      expect(result[2].end).to.be.equal(25);
    });
  });

  describe("verify header chain", function () {

    it("Should verify correct chain of blocks", function () {
      const startHeader = blockToHeader(config, generateEmptyBlock());
      const blocks = generateValidChain(startHeader);
      const result = isValidChainOfBlocks(config, startHeader, blocks);
      expect(result).to.be.true;
    });

    it("Should verify invalid chain of blocks - blocks out of order", function () {
      const startHeader = blockToHeader(config, generateEmptyBlock());
      const blocks = generateValidChain(startHeader);
      [blocks[0], blocks[1]] = [blocks[1], blocks[0]];
      const result = isValidChainOfBlocks(config, startHeader, blocks);
      expect(result).to.be.false;
    });

    it("Should verify invalid chain of blocks - different start header", function () {
      const startHeader = blockToHeader(config, generateEmptyBlock());
      const blocks = generateValidChain(startHeader);
      startHeader.slot = 99;
      const result = isValidChainOfBlocks(config, startHeader, blocks);
      expect(result).to.be.false;
    });

    it("Should verify invalid chain of blocks - invalid middle root", function () {
      const startHeader = blockToHeader(config, generateEmptyBlock());
      const blocks = generateValidChain(startHeader);
      blocks[1].message.parentRoot = Buffer.alloc(32);
      const result = isValidChainOfBlocks(config, startHeader, blocks);
      expect(result).to.be.false;
    });
  });

  describe("get blocks from peer", function () {

    it("should get block range from peer", async function () {
      const rpcStub = sinon.createStubInstance(ReqResp);
      rpcStub.beaconBlocksByRange
        .withArgs(sinon.match.any, sinon.match.any)
        .resolves([generateEmptySignedBlock()]);
      const result = await getBlockRangeFromPeer(
        rpcStub,
        {id: sinon.createStubInstance(PeerId)} as unknown as PeerInfo,
        {start: 1, end: 4}
      );
      expect(result.length).to.be.greaterThan(0);
      expect(rpcStub.beaconBlocksByRange.calledOnce).to.be.true;
    });

  });
  
  describe("is valid finalized checkpoint", function () {
    
    it("more than 50% peers have same finalized checkpoint", function () {
      const peers: IReputation[] = [
        // @ts-ignore
        {latestStatus: {finalizedRoot: Buffer.alloc(32, 1)}},
        // @ts-ignore
        {latestStatus: {finalizedRoot: Buffer.alloc(32, 0)}},
        // @ts-ignore
        {}
      ];
      const result = isValidFinalizedCheckPoint(peers, {root: Buffer.alloc(32, 1), epoch: 2});
      expect(result).to.be.true;
    });

    it("more than 50% peers have different finalized checkpoint", function () {
      const peers: IReputation[] = [
        // @ts-ignore
        {latestStatus: {finalizedRoot: Buffer.alloc(32, 1)}},
        // @ts-ignore
        {latestStatus: {finalizedRoot: Buffer.alloc(32, 0)}},
        // @ts-ignore
        {latestStatus: {finalizedRoot: Buffer.alloc(32, 0)}},
      ];
      const result = isValidFinalizedCheckPoint(peers, {root: Buffer.alloc(32, 1), epoch: 2});
      expect(result).to.be.false;
    });
    
  });

  describe("is valid peer for init sync", function() {
    it("should return false because no peer status", function() {
      expect(isValidPeerForInitSync(config, null, null)).to.be.false;
    });

    it("should return false because of out of date finalized checkpoint", function() {
      const peerStatus: Status = {
        finalizedEpoch: 5,
        finalizedRoot: Buffer.alloc(32),
        forkDigest: Buffer.alloc(4),
        headRoot: Buffer.alloc(32),
        headSlot: 0,
      };
      const state: BeaconState = generateState();
      state.finalizedCheckpoint.epoch = 10;
      expect(isValidPeerForInitSync(config, state, peerStatus)).to.be.false;
    });

    it("should return true", function() {
      const peerStatus: Status = {
        finalizedEpoch: 10,
        finalizedRoot: Buffer.alloc(32),
        forkDigest: Buffer.alloc(4),
        headRoot: Buffer.alloc(32),
        headSlot: 0,
      };
      const state: BeaconState = generateState();
      state.finalizedCheckpoint.epoch = 5;
      expect(isValidPeerForInitSync(config, state, peerStatus)).to.be.true;
    });
  });
    
});

function generateValidChain(start: BeaconBlockHeader, n = 3): SignedBeaconBlock[] {
  const blocks = [];
  let parentRoot = config.types.BeaconBlockHeader.hashTreeRoot(start);
  for(let i = 0; i < n; i++) {
    const block = generateEmptySignedBlock();
    block.message.parentRoot = parentRoot;
    block.message.slot = i;
    parentRoot = config.types.BeaconBlock.hashTreeRoot(block.message);
    blocks.push(block);
  }
  return blocks;
}

function generateReputation(finalizedEpoch: Epoch): IReputation {
  return {
    score: 1,
    latestMetadata: null,
    latestStatus: {
      finalizedEpoch: finalizedEpoch || 0,
      finalizedRoot: Buffer.alloc(1),
      forkDigest: Buffer.alloc(4),
      headRoot: Buffer.alloc(1),
      headSlot: 0
    }
  };
}
