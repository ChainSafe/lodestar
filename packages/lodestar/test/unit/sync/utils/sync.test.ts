import {describe} from "mocha";
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
  checkPeerSupportSync,
} from "../../../../src/sync/utils";
import {expect} from "chai";
import deepmerge from "deepmerge";
import * as blockUtils from "../../../../src/sync/utils/blocks";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {isPlainObject} from "@chainsafe/lodestar-utils";
import pipe from "it-pipe";
import sinon, {SinonFakeTimers, SinonStub, SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain, ILMDGHOST, StatefulDagLMDGHOST} from "../../../../src/chain";
import {collect} from "../../chain/blocks/utils";
import {ReqResp} from "../../../../src/network/reqResp";
import {generateEmptySignedBlock} from "../../../utils/block";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import PeerId from "peer-id";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {getEmptySignedBlock} from "../../../../src/chain/genesis/util";

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
        generateReputation({latestStatus: generateStatus({headSlot: 12})})
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
      root: Buffer.alloc(32, 4)
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
        root: Buffer.alloc(32, 4)
      };
      const result = getCommonFinalizedCheckpoint(
        config,
        [generateReputation({
          latestStatus: generateStatus({
            finalizedEpoch: checkpoint.epoch,
            finalizedRoot: checkpoint.root
          })
        })]
      );
      expect(config.types.Checkpoint.equals(checkpoint, result)).to.be.true;
    });

    it("majority", function () {
      const checkpoint: Checkpoint = {
        epoch: 1,
        root: Buffer.alloc(32, 4)
      };
      const result = getCommonFinalizedCheckpoint(
        config,
        [
          generateReputation({
            latestStatus: generateStatus({
              finalizedEpoch: checkpoint.epoch,
              finalizedRoot: checkpoint.root
            })
          }),
          generateReputation({
            latestStatus: generateStatus({
              finalizedEpoch: checkpoint.epoch,
              finalizedRoot: checkpoint.root
            })
          }),
          generateReputation({
            latestStatus: generateStatus({
              finalizedEpoch: 4,
              finalizedRoot: Buffer.alloc(32)
            })
          })
        ]
      );
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
          sinon.createStubInstance(ReqResp), getPeersStub),
        collect
      );
      await timer.tickAsync(30000);
      result = await result;
      expect(result.length).to.be.equal(0);
    });

    it("happy path", async function () {
      getPeersStub.resolves([{}]);
      getBlockRangeStub.resolves([generateEmptySignedBlock()]);
      const result = await pipe(
        [{start: 0, end: 10}],
        fetchBlockChunks(
          sinon.createStubInstance(WinstonLogger),
          sinon.createStubInstance(BeaconChain),
          sinon.createStubInstance(ReqResp), getPeersStub),
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
      forkChoiceStub = sinon.createStubInstance(StatefulDagLMDGHOST);
      chainStub.forkChoice = forkChoiceStub;
    });

    it("should work", async function () {
      forkChoiceStub.headBlockRoot.returns(generateEmptySignedBlock().message.parentRoot.valueOf() as Uint8Array);
      forkChoiceStub.headBlockSlot.returns(0);
      const block1 = generateEmptySignedBlock();
      block1.message.slot = 1;
      const block2 = generateEmptySignedBlock();
      block2.message.slot = 3;
      block2.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(block1.message);
      await pipe(
        [[block2], [block1]],
        processSyncBlocks(
          config, chainStub, sinon.createStubInstance(WinstonLogger), true),
      );
      expect(chainStub.receiveBlock.calledTwice).to.be.true;
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
        headSlot: 1000
      };
      reps.getFromPeerId(peer1).supportSync = true;
      reps.getFromPeerId(peer2).latestStatus = {
        forkDigest: Buffer.alloc(0),
        finalizedRoot: Buffer.alloc(0),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32, 2),
        headSlot: 2000
      };
      reps.getFromPeerId(peer2).supportSync = true;
      reps.getFromPeerId(peer4).latestStatus = {
        forkDigest: Buffer.alloc(0),
        finalizedRoot: Buffer.alloc(0),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32, 2),
        headSlot: 4000
      };
      // peer4 has highest slot but does not support sync
      reps.getFromPeerId(peer4).supportSync = false;

      expect(getBestHead(peers, reps)).to.be.deep.equal({slot: 2000, root: Buffer.alloc(32, 2), supportSync: true});
      expect(getBestPeer(config, peers, reps)).to.be.equal(peer2);
    });

    it("should handle no peer", () => {
      const reps = new ReputationStore();
      expect(getBestHead([], reps)).to.be.deep.equal({slot: 0, root: ZERO_HASH, supportSync: false});
      expect(getBestPeer(config, [], reps)).to.be.undefined;
    });
  });

  describe("checkPeerSupportSync", () => {
    let reqRespStub: SinonStubbedInstance<ReqResp>;
    beforeEach(() => {
      reqRespStub = sinon.createStubInstance(ReqResp);
    });
    afterEach(() => {
      sinon.restore();
    });

    it("not supported - no latest status", async () => {
      const peer1 = await PeerId.create();
      const reps = new ReputationStore();
      await checkPeerSupportSync(config, reps, peer1, reqRespStub);
      expect(reps.getFromPeerId(peer1).supportSync).to.be.false;
    });

    it("not supported - no chunk returned", async () => {
      const peer1 = await PeerId.create();
      const reps = new ReputationStore();
      reps.getFromPeerId(peer1).latestStatus = {
        forkDigest: Buffer.alloc(0),
        finalizedRoot: Buffer.alloc(0),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32, 1),
        headSlot: 1000
      };
      reqRespStub.beaconBlocksByRange.resolves([]);
      await checkPeerSupportSync(config, reps, peer1, reqRespStub);
      expect(reps.getFromPeerId(peer1).supportSync).to.be.false;
    });

    it("supported - 4 chunks returned", async () => {
      const peer1 = await PeerId.create();
      const reps = new ReputationStore();
      reps.getFromPeerId(peer1).latestStatus = {
        forkDigest: Buffer.alloc(0),
        finalizedRoot: Buffer.alloc(0),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32, 1),
        headSlot: 1000
      };
      reqRespStub.beaconBlocksByRange.resolves(Array(4).fill(getEmptySignedBlock(), 0));
      await checkPeerSupportSync(config, reps, peer1, reqRespStub);
      expect(reps.getFromPeerId(peer1).supportSync).to.be.true;
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
        headSlot: 0
      }
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
      headSlot: 0
    },
    overiddes,
    {isMergeableObject: isPlainObject}
  );
}
