import {IReputation, ReputationStore} from "../../../../src/sync/IReputation";
import {Checkpoint, Status} from "@chainsafe/lodestar-types";
import {
  fetchBlockChunks,
  getCommonFinalizedCheckpoint,
  getHighestCommonSlot,
  getStatusFinalizedCheckpoint,
  processSyncBlocks,
  getBestHead,
  getBestPeer,
  getPeerSupportedProtocols,
  checkBestPeer,
} from "../../../../src/sync/utils";
import {expect} from "chai";
import deepmerge from "deepmerge";
import * as blockUtils from "../../../../src/sync/utils/blocks";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {isPlainObject} from "@chainsafe/lodestar-utils";
import pipe from "it-pipe";
import sinon, {SinonFakeTimers, SinonStub, SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain, ILMDGHOST, ArrayDagLMDGHOST} from "../../../../src/chain";
import {collect} from "../../chain/blocks/utils";
import {ReqResp} from "../../../../src/network/reqResp";
import {generateEmptySignedBlock} from "../../../utils/block";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import PeerId from "peer-id";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {getEmptySignedBlock} from "../../../../src/chain/genesis/util";
import {Method} from "../../../../src/constants";
import {INetwork, Libp2pNetwork} from "../../../../src/network";
import {generatePeer} from "../../../utils/peer";

describe("sync utils", function () {
  let timer: SinonFakeTimers;

  beforeEach(function () {
    timer = sinon.useFakeTimers();
  });

  after(function () {
    timer.restore();
  });

  describe("get highest common slot", function () {
    it("no pears", function () {
      const result = getHighestCommonSlot([]);
      expect(result).to.be.equal(0);
    });

    it("no statuses", function () {
      const result = getHighestCommonSlot([generateReputation({latestStatus: null})]);
      expect(result).to.be.equal(0);
    });

    it("single rep", function () {
      const result = getHighestCommonSlot([generateReputation({latestStatus: generateStatus({headSlot: 10})})]);
      expect(result).to.be.equal(10);
    });

    it("majority", function () {
      const reps = [
        generateReputation({latestStatus: generateStatus({headSlot: 10})}),
        generateReputation({latestStatus: generateStatus({headSlot: 10})}),
        generateReputation({latestStatus: generateStatus({headSlot: 12})}),
      ];
      const result = getHighestCommonSlot(reps);
      expect(result).to.be.equal(10);
    });

    //It should be 10 as it's highest common slot, we need better algo for that to consider
    it.skip("disagreement", function () {
      const reps = [
        generateReputation({latestStatus: generateStatus({headSlot: 12})}),
        generateReputation({latestStatus: generateStatus({headSlot: 10})}),
        generateReputation({latestStatus: generateStatus({headSlot: 11})}),
      ];
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
      const result = getCommonFinalizedCheckpoint(config, [generateReputation({latestStatus: null})]);
      expect(result).to.be.null;
    });

    it("single peer", function () {
      const checkpoint: Checkpoint = {
        epoch: 1,
        root: Buffer.alloc(32, 4),
      };
      const result = getCommonFinalizedCheckpoint(config, [
        generateReputation({
          latestStatus: generateStatus({
            finalizedEpoch: checkpoint.epoch,
            finalizedRoot: checkpoint.root,
          }),
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
        generateReputation({
          latestStatus: generateStatus({
            finalizedEpoch: checkpoint.epoch,
            finalizedRoot: checkpoint.root,
          }),
        }),
        generateReputation({
          latestStatus: generateStatus({
            finalizedEpoch: checkpoint.epoch,
            finalizedRoot: checkpoint.root,
          }),
        }),
        generateReputation({
          latestStatus: generateStatus({
            finalizedEpoch: 4,
            finalizedRoot: Buffer.alloc(32),
          }),
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
        fetchBlockChunks(
          sinon.createStubInstance(WinstonLogger),
          sinon.createStubInstance(BeaconChain),
          sinon.createStubInstance(ReqResp),
          getPeersStub
        ),
        collect
      );
      await timer.tickAsync(30000);
      result = await result;
      expect(result.length).to.be.equal(1);
      expect(result[0]).to.be.null;
    });

    it("happy path", async function () {
      getPeersStub.resolves([{}]);
      getBlockRangeStub.resolves([generateEmptySignedBlock()]);
      const result = await pipe(
        [{start: 0, end: 10}],
        fetchBlockChunks(
          sinon.createStubInstance(WinstonLogger),
          sinon.createStubInstance(BeaconChain),
          sinon.createStubInstance(ReqResp),
          getPeersStub
        ),
        collect
      );
      expect(result.length).to.be.equal(1);
      expect(getBlockRangeStub.calledOnce).to.be.true;
    });
  });

  describe("block process", function () {
    let chainStub: SinonStubbedInstance<IBeaconChain>;
    let forkChoiceStub: SinonStubbedInstance<ILMDGHOST>;

    beforeEach(function () {
      chainStub = sinon.createStubInstance(BeaconChain);
      forkChoiceStub = sinon.createStubInstance(ArrayDagLMDGHOST);
      chainStub.forkChoice = forkChoiceStub;
    });

    it("should work", async function () {
      const lastProcessedBlock = generateEmptySignedBlock();
      const block1 = generateEmptySignedBlock();
      block1.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(lastProcessedBlock.message);
      block1.message.slot = 1;
      const block2 = generateEmptySignedBlock();
      block2.message.slot = 3;
      block2.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(block1.message);
      const lastProcesssedSlot = await pipe(
        [[block2], [block1]],
        processSyncBlocks(config, chainStub, sinon.createStubInstance(WinstonLogger), true, lastProcessedBlock)
      );
      expect(chainStub.receiveBlock.calledTwice).to.be.true;
      expect(lastProcesssedSlot).to.be.equal(3);
    });

    it("should handle failed to get range - initial sync", async function () {
      const lastProcessedBlock = generateEmptySignedBlock();
      lastProcessedBlock.message.slot = 10;
      const lastProcessSlot = await pipe(
        // failed to fetch range
        [null],
        processSyncBlocks(config, chainStub, sinon.createStubInstance(WinstonLogger), true, lastProcessedBlock)
      );
      expect(lastProcessSlot).to.be.equal(10);
    });

    it("should handle failed to get range - regular sync", async function () {
      forkChoiceStub.headBlockSlot.returns(100);
      const lastProcessSlot = await pipe(
        // failed to fetch range
        [null],
        processSyncBlocks(config, chainStub, sinon.createStubInstance(WinstonLogger), false, null)
      );
      expect(lastProcessSlot).to.be.equal(100);
    });

    it("should handle empty range - initial sync", async function () {
      const lastProcessedBlock = generateEmptySignedBlock();
      lastProcessedBlock.message.slot = 10;
      const lastProcessSlot = await pipe(
        // failed to fetch range
        [[]],
        processSyncBlocks(config, chainStub, sinon.createStubInstance(WinstonLogger), true, lastProcessedBlock)
      );
      expect(lastProcessSlot).to.be.null;
    });

    it("should handle empty range - regular sync", async function () {
      const lastProcessSlot = await pipe(
        // failed to fetch range
        [[]],
        processSyncBlocks(config, chainStub, sinon.createStubInstance(WinstonLogger), false, null)
      );
      expect(lastProcessSlot).to.be.null;
    });
  });

  describe("getBestHead and getBestPeer", () => {
    it("should get best head and best peer", async () => {
      const peer1 = await PeerId.create();
      const peer2 = await PeerId.create();
      const peer3 = await PeerId.create();
      const peer4 = await PeerId.create();
      const peers = [peer1, peer2, peer3, peer4];
      const reps = new ReputationStore();
      reps.add(peer1.toB58String());
      reps.add(peer2.toB58String());
      reps.add(peer3.toB58String());
      reps.getFromPeerId(peer1).latestStatus = {
        forkDigest: Buffer.alloc(0),
        finalizedRoot: Buffer.alloc(0),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32, 1),
        headSlot: 1000,
      };
      reps.getFromPeerId(peer2).latestStatus = {
        forkDigest: Buffer.alloc(0),
        finalizedRoot: Buffer.alloc(0),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32, 2),
        headSlot: 2000,
      };
      reps.getFromPeerId(peer4).latestStatus = {
        forkDigest: Buffer.alloc(0),
        finalizedRoot: Buffer.alloc(0),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32, 2),
        headSlot: 4000,
      };
      expect(getBestHead(peers, reps)).to.be.deep.equal({
        slot: 4000,
        root: Buffer.alloc(32, 2),
      });
      expect(getBestPeer(config, peers, reps)).to.be.equal(peer2);
    });

    it("should handle no peer", () => {
      const reps = new ReputationStore();
      expect(getBestHead([], reps)).to.be.deep.equal({slot: 0, root: ZERO_HASH});
      expect(getBestPeer(config, [], reps)).to.be.undefined;
    });
  });

  describe("getPeerSupportedProtocols", () => {
    let reqRespStub: SinonStubbedInstance<ReqResp>;
    beforeEach(() => {
      reqRespStub = sinon.createStubInstance(ReqResp);
    });
    afterEach(() => {
      sinon.restore();
    });

    it("no protocol - no latest status", async () => {
      const peer1 = await PeerId.create();
      const reps = new ReputationStore();
      const protocols = await getPeerSupportedProtocols(config, reps, peer1, reqRespStub);
      expect(protocols.length).to.be.equal(0);
    });

    it("no protocol - no chunk returned for beacon_blocks_by_root", async () => {
      const peer1 = await PeerId.create();
      const reps = new ReputationStore();
      reps.getFromPeerId(peer1).latestStatus = {
        forkDigest: Buffer.alloc(0),
        finalizedRoot: Buffer.alloc(0),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32, 1),
        headSlot: 1000,
      };
      reqRespStub.beaconBlocksByRoot.resolves([]);
      const protocols = await getPeerSupportedProtocols(config, reps, peer1, reqRespStub);
      expect(protocols.length).to.be.equal(0);
    });

    it("support beacon_blocks_by_range, beacon_blocks_by_root", async () => {
      const peer1 = await PeerId.create();
      const reps = new ReputationStore();
      const finallizedBlock = getEmptySignedBlock();
      finallizedBlock.message.slot = 100;
      const parentBlock = getEmptySignedBlock();
      parentBlock.message.slot = 99;
      finallizedBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(parentBlock.message);

      reps.getFromPeerId(peer1).latestStatus = {
        forkDigest: Buffer.alloc(0),
        finalizedRoot: config.types.BeaconBlock.hashTreeRoot(finallizedBlock.message),
        finalizedEpoch: 10,
        headRoot: Buffer.alloc(32, 1),
        headSlot: 1000,
      };
      reqRespStub.beaconBlocksByRoot.onFirstCall().resolves([finallizedBlock]);
      reqRespStub.beaconBlocksByRoot.onSecondCall().resolves([parentBlock]);
      reqRespStub.beaconBlocksByRange.resolves([parentBlock, finallizedBlock]);
      const protocols = await getPeerSupportedProtocols(config, reps, peer1, reqRespStub);
      expect(protocols).to.be.deep.equal([Method.BeaconBlocksByRoot, Method.BeaconBlocksByRange]);
    });
  });

  describe("checkBestPeer", function () {
    let networkStub: SinonStubbedInstance<INetwork>;
    let forkChoiceStub: SinonStubbedInstance<ILMDGHOST>;
    beforeEach(() => {
      networkStub = sinon.createStubInstance(Libp2pNetwork);
      forkChoiceStub = sinon.createStubInstance(ArrayDagLMDGHOST);
    });
    afterEach(() => {
      sinon.restore();
    });
    it("should return false, no peer", function () {
      expect(checkBestPeer(null!, null!, null!, null!)).to.be.false;
    });

    it("peer is disconnected", async function () {
      const peer1 = await PeerId.create();
      networkStub.getPeers.returns([]);
      expect(checkBestPeer(peer1, null!, networkStub, null!)).to.be.false;
      expect(networkStub.getPeers.calledOnce).to.be.true;
    });

    it("peer is connected but no status", async function () {
      const peer1 = await PeerId.create();
      networkStub.getPeers.returns([generatePeer(peer1)]);
      const reps = new ReputationStore();
      expect(checkBestPeer(peer1, forkChoiceStub, networkStub, reps)).to.be.false;
      expect(networkStub.getPeers.calledOnce).to.be.true;
      expect(forkChoiceStub.headBlockSlot.calledOnce).to.be.false;
    });

    it("peer head slot is not better than us", async function () {
      const peer1 = await PeerId.create();
      networkStub.getPeers.returns([generatePeer(peer1)]);
      const reps = new ReputationStore();
      reps.getFromPeerId(peer1).latestStatus = {
        finalizedEpoch: 0,
        finalizedRoot: Buffer.alloc(0),
        forkDigest: Buffer.alloc(0),
        headRoot: ZERO_HASH,
        headSlot: 10,
      };
      forkChoiceStub.headBlockSlot.returns(20);
      expect(checkBestPeer(peer1, forkChoiceStub, networkStub, reps)).to.be.false;
      expect(networkStub.getPeers.calledOnce).to.be.true;
      expect(forkChoiceStub.headBlockSlot.calledOnce).to.be.true;
    });

    it("peer is good for best peer", async function () {
      const peer1 = await PeerId.create();
      networkStub.getPeers.returns([generatePeer(peer1)]);
      const reps = new ReputationStore();
      reps.getFromPeerId(peer1).latestStatus = {
        finalizedEpoch: 0,
        finalizedRoot: Buffer.alloc(0),
        forkDigest: Buffer.alloc(0),
        headRoot: ZERO_HASH,
        headSlot: 30,
      };
      forkChoiceStub.headBlockSlot.returns(20);
      expect(checkBestPeer(peer1, forkChoiceStub, networkStub, reps)).to.be.true;
      expect(networkStub.getPeers.calledOnce).to.be.true;
      expect(forkChoiceStub.headBlockSlot.calledOnce).to.be.true;
    });
  });
});

function generateReputation(overiddes: Partial<IReputation>): IReputation {
  return deepmerge(
    {
      score: 1,
      latestMetadata: null,
      latestStatus: {
        finalizedEpoch: 0,
        finalizedRoot: Buffer.alloc(1),
        headForkVersion: Buffer.alloc(4),
        headRoot: Buffer.alloc(1),
        headSlot: 0,
      },
    },
    overiddes,
    {isMergeableObject: isPlainObject}
  );
}

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
