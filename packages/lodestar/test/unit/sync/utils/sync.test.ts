import {expect} from "chai";
import deepmerge from "deepmerge";
import PeerId from "peer-id";
import sinon, {SinonStubbedInstance} from "sinon";

import {Checkpoint, Status} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/minimal";
import {isPlainObject} from "@chainsafe/lodestar-utils";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {
  checkBestPeer,
  checkLinearChainSegment,
  getBestHead,
  getBestPeer,
  getStatusFinalizedCheckpoint,
} from "../../../../src/sync/utils";
import {generateBlockSummary, generateEmptySignedBlock} from "../../../utils/block";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {INetwork, Libp2pNetwork} from "../../../../src/network";
import {generatePeer} from "../../../utils/peer";
import {IPeerMetadataStore} from "../../../../src/network/peers/interface";
import {Libp2pPeerMetadataStore} from "../../../../src/network/peers/metastore";
import {IRpcScoreTracker, SimpleRpcScoreTracker} from "../../../../src/network/peers";

describe("sync utils", function () {
  const sandbox = sinon.createSandbox();

  beforeEach(function () {
    sandbox.useFakeTimers();
  });

  after(function () {
    sandbox.restore();
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
