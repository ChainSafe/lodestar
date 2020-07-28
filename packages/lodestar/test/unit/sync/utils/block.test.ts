import {afterEach, beforeEach, describe, it} from "mocha";
import {ReqResp} from "../../../../src/network/reqResp";
import sinon, {SinonStubbedInstance} from "sinon";
import {chunkify, getBlockRange, getBlockRangeFromPeer, isValidChainOfBlocks, toBlocks, shouldRetryRange, getBlockRangeInterleave} from "../../../../src/sync/utils";
import {expect} from "chai";
import {generateEmptyBlock, generateEmptySignedBlock, generateSignedBlock} from "../../../utils/block";
import {blockToHeader} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/src/presets/minimal";
import PeerId from "peer-id";
import {BeaconBlockHeader, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils";
import {ISlotRange} from "../../../../lib/sync";

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
      const peer1 = await PeerId.create();
      const peer2 = await PeerId.create();
      const peers = [peer1, peer2];
      rpcStub.beaconBlocksByRange
        .withArgs(sinon.match(peers[0]).or(sinon.match(peers[1])), sinon.match.any)
        .resolves([generateEmptySignedBlock(), generateEmptySignedBlock(), generateEmptySignedBlock()]);
      const blocks = await getBlockRange(loggerStub, rpcStub, peers, {start: 0, end: 4}, 2);
      expect(blocks.length).to.be.equal(3);
    });

    it("refetch failed chunks", async function () {
      const timer = sinon.useFakeTimers();
      const peer1 = await PeerId.create();
      const peer2 = await PeerId.create();
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
      const peer1 = new PeerId(Buffer.from("lodestar"));
      const peers: PeerId[] = [peer1];
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

  describe("getBlockRangeInterleave", function () {
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

    it("happy path - single peer", async function() {
      const peers = [new PeerId(Buffer.from("lodestar1")), new PeerId(Buffer.from("lodestar2"))];
      // 1 single request to 1 peer is enough
      const range = {start: 3, end: 7};
      rpcStub.beaconBlocksByRange
        .resolves([generateSignedBlock({message: {slot: 7}})]);
      const blocks = await getBlockRangeInterleave(loggerStub, rpcStub, peers, range);
      expect(rpcStub.beaconBlocksByRange.calledOnce).to.be.true;
      expect(blocks.length).to.be.equal(1);
      expect(blocks[0].message.slot).to.be.equal(7);
    });

    it("happy path - 2 peers", async function() {
      const peers = [new PeerId(Buffer.from("lodestar1")), new PeerId(Buffer.from("lodestar2"))];
      const range = {start: 3, end: 9};
      rpcStub.beaconBlocksByRange
        .withArgs(sinon.match.any, {startSlot: 3, step: 2, count: 4})
        .resolves([generateSignedBlock({message: {slot: 9}})]);
      rpcStub.beaconBlocksByRange
        .withArgs(sinon.match.any, {startSlot: 4, step: 2, count: 3})
        .resolves([generateSignedBlock({message: {slot: 8}})]);
      const blocks = await getBlockRangeInterleave(loggerStub, rpcStub, peers, range);
      expect(rpcStub.beaconBlocksByRange.calledTwice).to.be.true;
      expect(blocks.length).to.be.equal(2);
      expect(blocks[0].message.slot).to.be.equal(8);
      expect(blocks[1].message.slot).to.be.equal(9);
    });

    it("retry because of not expected end block", async function() {
      const peers = [new PeerId(Buffer.from("lodestar1")), new PeerId(Buffer.from("lodestar2"))];
      const range = {start: 3, end: 9};
      // this is best peer, its even not up to date
      rpcStub.beaconBlocksByRange
        .withArgs(sinon.match.any, {startSlot: 3, step: 2, count: 4})
        .resolves([generateSignedBlock({message: {slot: 7}})]);
      // retry this again as we expect 8 as end block
      rpcStub.beaconBlocksByRange
        .withArgs(sinon.match.any, {startSlot: 4, step: 2, count: 3})
        .resolves([generateSignedBlock({message: {slot: 6}})]);
      rpcStub.beaconBlocksByRange
        .onThirdCall()
        .resolves([generateSignedBlock({message: {slot: 8}})]);
      const blocks = await getBlockRangeInterleave(loggerStub, rpcStub, peers, range);
      expect(rpcStub.beaconBlocksByRange.calledThrice).to.be.true;
      expect(blocks.length).to.be.equal(3);
      expect(blocks[0].message.slot).to.be.equal(6);
      expect(blocks[1].message.slot).to.be.equal(7);
      expect(blocks[2].message.slot).to.be.equal(8);
    });

    it("retry because of error", async function() {
      const peers = [new PeerId(Buffer.from("lodestar1")), new PeerId(Buffer.from("lodestar2"))];
      const range = {start: 3, end: 9};
      rpcStub.beaconBlocksByRange
        .withArgs(sinon.match.any, {startSlot: 3, step: 2, count: 4})
        .resolves([generateSignedBlock({message: {slot: 9}})]);
      rpcStub.beaconBlocksByRange
        .withArgs(sinon.match.any, {startSlot: 4, step: 2, count: 3})
        .onFirstCall()
        .resolves(undefined);
      rpcStub.beaconBlocksByRange
        // retry with same range
        .withArgs(sinon.match.any, {startSlot: 4, step: 2, count: 3})
        .onSecondCall()
        .resolves([generateSignedBlock({message: {slot: 8}})]);
      const blocks = await getBlockRangeInterleave(loggerStub, rpcStub, peers, range);
      expect(rpcStub.beaconBlocksByRange.calledThrice).to.be.true;
      expect(blocks.length).to.be.equal(2);
      expect(blocks[0].message.slot).to.be.equal(8);
      expect(blocks[1].message.slot).to.be.equal(9);
    });

    it("no retry, return empty array", async function() {
      const peers = [new PeerId(Buffer.from("lodestar1")), new PeerId(Buffer.from("lodestar2"))];
      const range = {start: 3, end: 9};
      rpcStub.beaconBlocksByRange.resolves(undefined);
      const blocks = await getBlockRangeInterleave(loggerStub, rpcStub, peers, range);
      expect(rpcStub.beaconBlocksByRange.calledTwice).to.be.true;
      expect(blocks.length).to.be.equal(0);
      expect(loggerStub.warn.calledOnceWith(
        sinon.match("All beacon_block_by_range requests return null or no block for range"))).to.be.true;
    });
  });

  describe("toBlocks", function () {
    it("should merge all blocks from request", function() {
      const request0Blocks = [generateSignedBlock()];
      const request1Blocks = [generateSignedBlock()];
      const request2Blocks = null;
      expect(toBlocks([request0Blocks, request1Blocks, request2Blocks]).length).to.be.equal(2);
    });
  });

  describe("shouldRetryRange", function () {
    it("should return false - step=1", () => {
      const step = 1;
      const range: ISlotRange = {start: 3, end: 10};
      // even latest slot is not expected, don't want to retry because there is 1 peer only
      const blocks = [generateSignedBlock({message: {slot: 3}})];
      expect(shouldRetryRange(range, blocks, step)).to.be.false;
    });
    it("should return false - end slot is expected", () => {
      const step = 3;
      const range: ISlotRange = {start: 3, end: 10};
      const blocks = [generateSignedBlock({message: {slot: 9}})];
      expect(shouldRetryRange(range, blocks, step)).to.be.false;
    });
    it("should return true", () => {
      const step = 3;
      const range: ISlotRange = {start: 3, end: 10};
      // expect slot 9 as last block
      const blocks = [generateSignedBlock({message: {slot: 6}})];
      expect(shouldRetryRange(range, blocks, step)).to.be.true;
    });
    it("should return true - undefined blocks", () => {
      const step = 3;
      const range: ISlotRange = {start: 3, end: 10};
      // in case of beacon_block_by_range error, blocks is undefined
      const blocks = undefined;
      expect(shouldRetryRange(range, blocks, step)).to.be.true;
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

    it("should get block range from peer, step = 1", async function () {
      const rpcStub = sinon.createStubInstance(ReqResp);
      rpcStub.beaconBlocksByRange
        .withArgs(sinon.match.any, sinon.match.any)
        .resolves([generateEmptySignedBlock()]);
      const result = await getBlockRangeFromPeer(
        rpcStub,
        sinon.createStubInstance(PeerId),
        {start: 1, end: 4}
      );
      expect(result.length).to.be.greaterThan(0);
      expect(rpcStub.beaconBlocksByRange.calledOnce).to.be.true;
    });

    it("should get block range from peer, step = 2", async function () {
      const spy = sinon.spy();
      const rpcStub = sinon.createStubInstance(ReqResp);
      rpcStub.beaconBlocksByRange
        .withArgs(sinon.match.any, sinon.match.any)
        .resolves([generateEmptySignedBlock()]);
      rpcStub.beaconBlocksByRange.callsFake(spy);
      const step = 2;
      const result = await getBlockRangeFromPeer(
        rpcStub,
        sinon.createStubInstance(PeerId),
        {start: 3, end: 10},
        step
      );
      expect(result.length).to.be.greaterThan(0);
      // we want to query block 3, 5, 7, 9
      expect(rpcStub.beaconBlocksByRange.calledOnceWith(
        sinon.match.any, sinon.match({startSlot: 3, step: 2, count: 4}))).to.be.true;
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
