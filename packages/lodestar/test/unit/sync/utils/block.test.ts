import {afterEach, beforeEach, describe, it} from "mocha";
import {ReqResp} from "../../../../src/network/reqResp";
import sinon, {SinonStubbedInstance} from "sinon";
import {chunkify, getBlockRange, getBlockRangeFromPeer, isValidChainOfBlocks} from "../../../../src/sync/utils";
import PeerInfo from "peer-info";
import {expect} from "chai";
import {generateEmptyBlock, generateEmptySignedBlock} from "../../../utils/block";
import {blockToHeader} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/src/presets/minimal";
import PeerId from "peer-id";
import {BeaconBlockHeader, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils";

describe("sync - block utils", function () {

  describe("get block range from multiple peers", function () {

    const sandbox = sinon.createSandbox();

    let rpcStub: SinonStubbedInstance<ReqResp>;
    let loggerStub: SinonStubbedInstance<ILogger>;

    beforeEach(function () {
      rpcStub = sandbox.createStubInstance(ReqResp);
      loggerStub = sandbox.createStubInstance(WinstonLogger);
    });

    afterEach(function () {
      sandbox.restore();
    });

    it("happy path", async function () {
      const peer1 = new PeerInfo(await PeerId.create());
      const peer2 = new PeerInfo(await PeerId.create());
      const peers = [peer1, peer2];
      rpcStub.beaconBlocksByRange
        .withArgs(sinon.match(peers[0]).or(sinon.match(peers[1])), sinon.match.any)
        .resolves([generateEmptySignedBlock(), generateEmptySignedBlock(), generateEmptySignedBlock()]);
      const blocks = await getBlockRange(loggerStub, rpcStub, peers, {start: 0, end: 4}, 2);
      expect(blocks.length).to.be.equal(3);
    });

    it("refetch failed chunks", async function () {
      const timer = sinon.useFakeTimers();
      const peer1 = new PeerInfo(await PeerId.create());
      const peer2 = new PeerInfo(await PeerId.create());
      const peers = [peer1, peer2];
      rpcStub.beaconBlocksByRange
        .onFirstCall()
        .resolves(null);
      rpcStub.beaconBlocksByRange
        .onSecondCall()
        .resolves([generateEmptySignedBlock(), generateEmptySignedBlock()]);
      const blockPromise = getBlockRange(loggerStub, rpcStub, peers, {start: 0, end: 4}, 2);
      await timer.tickAsync(1000);
      const blocks = await blockPromise;
      expect(blocks.length).to.be.equal(2);
      timer.reset();
    });

    it("no chunks", async function () {
      const peer1 = {id: 1} as unknown as PeerInfo;
      const peers: PeerInfo[] = [peer1];
      rpcStub.beaconBlocksByRange.resolves([]);
      const blocks = await getBlockRange(loggerStub, rpcStub, peers, {start: 4, end: 4}, 2);
      expect(blocks.length).to.be.equal(0);
    });

  });

  describe("Chunkify block range", function () {
    it("should return chunks of block range", function () {
      const result = chunkify(10, 0, 30);
      expect(result.length).to.be.equal(3);
      expect(result[0].start).to.be.equal(0);
      expect(result[0].end).to.be.equal(10);
      expect(result[1].start).to.be.equal(11);
      expect(result[1].end).to.be.equal(21);
      expect(result[2].start).to.be.equal(22);
      expect(result[2].end).to.be.equal(30);
    });

    it("should return chunks of block range - not rounded", function () {
      const result = chunkify(10, 0, 25);
      expect(result.length).to.be.equal(3);
      expect(result[2].start).to.be.equal(22);
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
