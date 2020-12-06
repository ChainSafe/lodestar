import {expect} from "chai";
import deepmerge from "deepmerge";
import all from "it-all";
import pipe from "it-pipe";
import PeerId from "peer-id";
import sinon, {SinonStub, SinonStubbedInstance} from "sinon";

import {Checkpoint, Status} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/minimal";
import {isPlainObject} from "@chainsafe/lodestar-utils";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {
  checkBestPeer,
  checkLinearChainSegment,
  fetchBlockChunks,
  getBestHead,
  getBestPeer,
  getCommonFinalizedCheckpoint,
  getHighestCommonSlot,
  getStatusFinalizedCheckpoint,
  processSyncBlocks,
} from "../../../../src/sync/utils";
import * as blockUtils from "../../../../src/sync/utils/blocks";
import {BeaconChain, IBeaconChain} from "../../../../src/chain";
import {ReqResp} from "../../../../src/network/reqresp/reqResp";
import {generateBlockSummary, generateEmptySignedBlock} from "../../../utils/block";
import {ZERO_HASH, blockToHeader} from "@chainsafe/lodestar-beacon-state-transition";
import {INetwork, Libp2pNetwork} from "../../../../src/network";
import {generatePeer} from "../../../utils/peer";
import {IPeerMetadataStore} from "../../../../src/network/peers/interface";
import {Libp2pPeerMetadataStore} from "../../../../src/network/peers/metastore";
import {silentLogger} from "../../../utils/logger";
import {IRpcScoreTracker, SimpleRpcScoreTracker} from "../../../../src/network/peers";

describe("sync utils", function () {
  const logger = silentLogger;
  const sandbox = sinon.createSandbox();

  beforeEach(function () {
    sandbox.useFakeTimers();
  });

  after(function () {
    sandbox.restore();
  });

  describe("get highest common slot", function () {
    it("no pears", function () {
      const result = getHighestCommonSlot([]);
      expect(result).to.be.equal(0);
    });

    it("no statuses", function () {
      const result = getHighestCommonSlot([null]);
      expect(result).to.be.equal(0);
    });

    it("single rep", function () {
      const result = getHighestCommonSlot([generateStatus({headSlot: 10})]);
      expect(result).to.be.equal(10);
    });

    it("majority", function () {
      const reps = [generateStatus({headSlot: 10}), generateStatus({headSlot: 10}), generateStatus({headSlot: 12})];
      const result = getHighestCommonSlot(reps);
      expect(result).to.be.equal(10);
    });

    //It should be 10 as it's highest common slot, we need better algo for that to consider
    it.skip("disagreement", function () {
      const reps = [generateStatus({headSlot: 12}), generateStatus({headSlot: 10}), generateStatus({headSlot: 11})];
      const result = getHighestCommonSlot(reps);
      expect(result).to.be.equal(10);
    });
  });

  it("status to finalized checkpoint", function () {
    const checkpoint: Checkpoint = {
      epoch: 1,
      root: Buffer.alloc(32, 4),
    };
    const status = generateStatus({finalizedEpoch: checkpoint.epoch, finalizedRoot: checkpoint.root});
    const result = getStatusFinalizedCheckpoint(status);
    expect(config.types.Checkpoint.equals(result, checkpoint)).to.be.true;
  });

  describe("get common finalized checkpoint", function () {
    it("no peers", function () {
      const result = getCommonFinalizedCheckpoint(config, []);
      expect(result).to.be.null;
    });

    it("no statuses", function () {
      const result = getCommonFinalizedCheckpoint(config, [null]);
      expect(result).to.be.null;
    });

    it("single peer", function () {
      const checkpoint: Checkpoint = {
        epoch: 1,
        root: Buffer.alloc(32, 4),
      };
      const result = getCommonFinalizedCheckpoint(config, [
        generateStatus({
          finalizedEpoch: checkpoint.epoch,
          finalizedRoot: checkpoint.root,
        }),
      ]);
      if (!result) throw Error("getCommonFinalizedCheckpoint returned null");
      expect(config.types.Checkpoint.equals(checkpoint, result)).to.be.true;
    });

    it("majority", function () {
      const checkpoint: Checkpoint = {
        epoch: 1,
        root: Buffer.alloc(32, 4),
      };
      const result = getCommonFinalizedCheckpoint(config, [
        generateStatus({
          finalizedEpoch: checkpoint.epoch,
          finalizedRoot: checkpoint.root,
        }),
        generateStatus({
          finalizedEpoch: checkpoint.epoch,
          finalizedRoot: checkpoint.root,
        }),
        generateStatus({
          finalizedEpoch: 4,
          finalizedRoot: Buffer.alloc(32),
        }),
      ]);
      if (!result) throw Error("getCommonFinalizedCheckpoint returned null");
      expect(config.types.Checkpoint.equals(checkpoint, result)).to.be.true;
    });
  });

  describe("fetchBlockChunk process", function () {
    const sandbox = sinon.createSandbox();

    let getPeersStub: SinonStub, getBlockRangeStub: SinonStub;

    beforeEach(function () {
      sandbox.useFakeTimers();
      getPeersStub = sinon.stub();
      getBlockRangeStub = sandbox.stub(blockUtils, "getBlockRange");
    });

    afterEach(function () {
      sandbox.restore();
    });

    it("no peers", async function () {
      getPeersStub.resolves([]);
      getBlockRangeStub.resolves([generateEmptySignedBlock()]);
      let result = pipe(
        [{start: 0, end: 10}],
        fetchBlockChunks(logger, sinon.createStubInstance(ReqResp), getPeersStub),
        all
      );
      await sandbox.clock.tickAsync(30000);
      result = await result;
      expect(result.length).to.be.equal(1);
      expect(result[0]).to.be.null;
    });

    it("happy path", async function () {
      getPeersStub.resolves([{}]);
      getBlockRangeStub.resolves([generateEmptySignedBlock()]);
      const result = await pipe(
        [{start: 0, end: 10}],
        fetchBlockChunks(logger, sinon.createStubInstance(ReqResp), getPeersStub),
        all
      );
      expect(result.length).to.be.equal(1);
      expect(getBlockRangeStub.calledOnce).to.be.true;
    });
  });

  describe("block process", function () {
    let chainStub: SinonStubbedInstance<IBeaconChain>;
    let forkChoiceStub: SinonStubbedInstance<ForkChoice>;

    beforeEach(function () {
      chainStub = sinon.createStubInstance(BeaconChain);
      forkChoiceStub = sinon.createStubInstance(ForkChoice);
      chainStub.forkChoice = forkChoiceStub;
    });

    it("should not import last fetched block", async function () {
      const lastProcessedBlock = blockToHeader(config, generateEmptySignedBlock().message);
      const blockRoot = config.types.BeaconBlockHeader.hashTreeRoot(lastProcessedBlock);
      const block1 = generateEmptySignedBlock();
      block1.message.parentRoot = blockRoot;
      block1.message.slot = 1;
      const block2 = generateEmptySignedBlock();
      block2.message.slot = 2;
      block2.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(block1.message);
      // last fetched block maybe an orphaned block
      const block3 = generateEmptySignedBlock();
      block3.message.slot = 3;
      block3.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(block2.message);
      const lastProcesssedSlot = await pipe(
        [[block1, block2, block3]],
        processSyncBlocks(config, chainStub, logger, true, {blockRoot, slot: lastProcessedBlock.slot}, true)
      );
      expect(chainStub.receiveBlock.calledWith(block1, true)).to.be.true;
      expect(chainStub.receiveBlock.calledWith(block2, true)).to.be.true;
      expect(chainStub.receiveBlock.calledTwice).to.be.true;
      expect(lastProcesssedSlot).to.be.equal(2);
    });

    it("should not import orphaned block", async function () {
      const lastProcessedBlock = blockToHeader(config, generateEmptySignedBlock().message);
      const blockRoot = config.types.BeaconBlockHeader.hashTreeRoot(lastProcessedBlock);
      const block1 = generateEmptySignedBlock();
      block1.message.parentRoot = blockRoot;
      block1.message.slot = 1;
      const block2 = generateEmptySignedBlock();
      block2.message.slot = 2;
      block2.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(block1.message);
      // last fetched block maybe an orphaned block
      const orphanedBlock = generateEmptySignedBlock();
      orphanedBlock.message.slot = 3;
      const lastBlock = generateEmptySignedBlock();
      lastBlock.message.slot = 4;
      const lastProcesssedSlot = await pipe(
        [[block1, block2, orphanedBlock, lastBlock]],
        processSyncBlocks(config, chainStub, logger, true, {blockRoot, slot: lastProcessedBlock.slot}, true)
      );
      // only block 1 is imported bc block2 does not link to a child
      // don't import orphaned and last block
      expect(chainStub.receiveBlock.calledOnceWith(block1, true)).to.be.true;
      expect(lastProcesssedSlot).to.be.equal(1);
    });

    it("should handle failed to get range - initial sync", async function () {
      const lastProcessedBlock = {blockRoot: ZERO_HASH, slot: 10};
      const lastProcessSlot = await pipe(
        // failed to fetch range
        [null],
        processSyncBlocks(config, chainStub, logger, true, lastProcessedBlock)
      );
      expect(lastProcessSlot).to.be.equal(10);
    });

    it("should handle failed to get range - regular sync", async function () {
      const lastProcessSlot = await pipe(
        // failed to fetch range
        [null],
        processSyncBlocks(config, chainStub, logger, false, {slot: 100, blockRoot: ZERO_HASH})
      );
      expect(lastProcessSlot).to.be.equal(100);
    });

    it("should handle empty range - initial sync", async function () {
      const lastProcessedBlock = {blockRoot: ZERO_HASH, slot: 10};
      const lastProcessSlot = await pipe(
        // failed to fetch range
        [[]],
        processSyncBlocks(config, chainStub, logger, true, lastProcessedBlock)
      );
      expect(lastProcessSlot).to.be.null;
    });

    it("should handle empty range - regular sync", async function () {
      const lastProcessSlot = await pipe(
        // empty range
        [[]],
        processSyncBlocks(config, chainStub, logger, false, {slot: 100, blockRoot: ZERO_HASH})
      );
      expect(lastProcessSlot).to.be.null;
    });
  });

  describe("getBestHead and getBestPeer", () => {
    let metastoreStub: SinonStubbedInstance<IPeerMetadataStore>;

    beforeEach(function () {
      metastoreStub = sinon.createStubInstance(Libp2pPeerMetadataStore);
    });

    it("should get best head and best peer", async () => {
      const peer1 = await PeerId.create();
      const peer2 = await PeerId.create();
      const peer3 = await PeerId.create();
      const peer4 = await PeerId.create();
      const peers = [peer1, peer2, peer3, peer4];
      metastoreStub.getStatus.withArgs(peer1).returns({
        forkDigest: Buffer.alloc(0),
        finalizedRoot: Buffer.alloc(0),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32, 1),
        headSlot: 1000,
      });
      metastoreStub.getStatus.withArgs(peer2).returns({
        forkDigest: Buffer.alloc(0),
        finalizedRoot: Buffer.alloc(0),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32, 2),
        headSlot: 2000,
      });
      metastoreStub.getStatus.withArgs(peer3).returns({
        forkDigest: Buffer.alloc(0),
        finalizedRoot: Buffer.alloc(0),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32, 2),
        headSlot: 4000,
      });
      expect(getBestHead(peers, metastoreStub)).to.be.deep.equal({
        slot: 4000,
        root: Buffer.alloc(32, 2),
      });
      expect(getBestPeer(config, peers, metastoreStub)).to.be.equal(peer2);
    });

    it("should handle no peer", () => {
      expect(getBestHead([], metastoreStub)).to.be.deep.equal({slot: 0, root: ZERO_HASH});
      expect(getBestPeer(config, [], metastoreStub)).to.be.undefined;
    });
  });

  describe("checkBestPeer", function () {
    let networkStub: SinonStubbedInstance<INetwork>;
    let forkChoiceStub: SinonStubbedInstance<ForkChoice> & ForkChoice;
    let metastoreStub: SinonStubbedInstance<IPeerMetadataStore>;
    let peerScoreStub: SinonStubbedInstance<IRpcScoreTracker>;

    beforeEach(() => {
      metastoreStub = sinon.createStubInstance(Libp2pPeerMetadataStore);
      networkStub = sinon.createStubInstance(Libp2pNetwork);
      networkStub.peerMetadata = metastoreStub;
      forkChoiceStub = sinon.createStubInstance(ForkChoice) as SinonStubbedInstance<ForkChoice> & ForkChoice;
      peerScoreStub = sinon.createStubInstance(SimpleRpcScoreTracker);
      networkStub.peerRpcScores = peerScoreStub;
    });
    afterEach(() => {
      sinon.restore();
    });
    it("should return false, no peer", function () {
      networkStub.getPeers.returns([]);
      expect(checkBestPeer(null!, forkChoiceStub, networkStub)).to.be.false;
    });

    it("peer is disconnected", async function () {
      const peer1 = await PeerId.create();
      networkStub.getPeers.returns([]);
      expect(checkBestPeer(peer1, forkChoiceStub, networkStub)).to.be.false;
      expect(networkStub.getPeers.calledOnce).to.be.true;
      expect(forkChoiceStub.getHead.calledOnce).to.be.false;
    });

    it("peer is connected but no status", async function () {
      const peer1 = await PeerId.create();
      networkStub.getPeers.returns([generatePeer(peer1)]);
      expect(checkBestPeer(peer1, forkChoiceStub, networkStub)).to.be.false;
      expect(networkStub.getPeers.calledOnce).to.be.true;
      expect(forkChoiceStub.getHead.calledOnce).to.be.false;
    });

    it("not enough peer score", async function () {
      const peer1 = await PeerId.create();
      networkStub.getPeers.returns([generatePeer(peer1)]);
      forkChoiceStub.getHead.returns(generateBlockSummary({slot: 20}));
      peerScoreStub.getScore.returns(20);
      expect(checkBestPeer(peer1, forkChoiceStub, networkStub)).to.be.false;
      expect(networkStub.getPeers.calledOnce).to.be.true;
      expect(peerScoreStub.getScore.calledOnce).to.be.true;
      expect(forkChoiceStub.getHead.calledOnce).to.be.false;
    });

    it("peer head slot is not better than us", async function () {
      const peer1 = await PeerId.create();
      networkStub.getPeers.returns([generatePeer(peer1)]);
      metastoreStub.getStatus.withArgs(peer1).returns({
        finalizedEpoch: 0,
        finalizedRoot: Buffer.alloc(0),
        forkDigest: Buffer.alloc(0),
        headRoot: ZERO_HASH,
        headSlot: 10,
      });
      forkChoiceStub.getHead.returns(generateBlockSummary({slot: 20}));
      peerScoreStub.getScore.returns(150);
      expect(checkBestPeer(peer1, forkChoiceStub, networkStub)).to.be.false;
      expect(networkStub.getPeers.calledOnce).to.be.true;
      expect(peerScoreStub.getScore.calledOnce).to.be.true;
      expect(forkChoiceStub.getHead.calledOnce).to.be.true;
    });

    it("peer is good for best peer", async function () {
      const peer1 = await PeerId.create();
      networkStub.getPeers.returns([generatePeer(peer1)]);
      metastoreStub.getStatus.withArgs(peer1).returns({
        finalizedEpoch: 0,
        finalizedRoot: Buffer.alloc(0),
        forkDigest: Buffer.alloc(0),
        headRoot: ZERO_HASH,
        headSlot: 30,
      });
      peerScoreStub.getScore.returns(150);
      forkChoiceStub.getHead.returns(generateBlockSummary({slot: 20}));
      expect(checkBestPeer(peer1, forkChoiceStub, networkStub)).to.be.true;
      expect(networkStub.getPeers.calledOnce).to.be.true;
      expect(peerScoreStub.getScore.calledOnce).to.be.true;
      expect(forkChoiceStub.getHead.calledOnce).to.be.true;
    });
  });

  describe("checkLinearChainSegment", function () {
    it("should throw error if not enough block", () => {
      expect(() => checkLinearChainSegment(config, null)).to.throw("Not enough blocks to validate");
      expect(() => checkLinearChainSegment(config, [])).to.throw("Not enough blocks to validate");
      expect(() => checkLinearChainSegment(config, [generateEmptySignedBlock()])).to.throw("Not enough blocks to validate");
    });

    it("should throw error if first block not link to ancestor root", () => {
      const block = generateEmptySignedBlock();
      expect(() => checkLinearChainSegment(config, [block, block])).to.throw("Block 0 does not link to parent 0xeade62f0457b2fdf48e7d3fc4b60736688286be7c7a3ac4c9a16a5e0600bd9e4");
    });

    it("should throw error if second block not link to first block", () => {
      const firstBlock = generateEmptySignedBlock();
      const ancestorRoot = firstBlock.message.parentRoot;
      const secondBlock = generateEmptySignedBlock();
      secondBlock.message.slot = 1;
      // secondBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(firstBlock.message);
      expect(() => checkLinearChainSegment(config, [firstBlock, secondBlock], ancestorRoot)).to.throw("Block 1 does not link to parent 0xeade62f0457b2fdf48e7d3fc4b60736688286be7c7a3ac4c9a16a5e0600bd9e4");
    });

    it("should form linear chain segment", () => {
      const firstBlock = generateEmptySignedBlock();
      const ancestorRoot = firstBlock.message.parentRoot;
      const secondBlock = generateEmptySignedBlock();
      secondBlock.message.slot = 1;
      secondBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(firstBlock.message);
      checkLinearChainSegment(config, [firstBlock, secondBlock], ancestorRoot);
      // no error thrown means success
    });
  });
});

function generateStatus(overiddes: Partial<Status>): Status {
  return deepmerge(
    {
      finalizedEpoch: 0,
      finalizedRoot: Buffer.alloc(1),
      headForkVersion: Buffer.alloc(4),
      headRoot: Buffer.alloc(1),
      headSlot: 0,
    },
    overiddes,
    {isMergeableObject: isPlainObject}
  );
}
