import {expect} from "chai";
import PeerId from "peer-id";
import sinon, {SinonStubbedInstance} from "sinon";

import {config} from "@chainsafe/lodestar-config/minimal";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {checkBestPeer, getBestHead, getBestPeer} from "../../../../src/sync/utils";
import {generateBlockSummary} from "../../../utils/block";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {INetwork, Network} from "../../../../src/network";
import {IPeerRpcScoreStore, PeerRpcScoreStore, ScoreState} from "../../../../src/network/peers";
import {getStubbedMetadataStore, StubbedIPeerMetadataStore} from "../../../utils/peer";

describe("sync utils", function () {
  const sandbox = sinon.createSandbox();

  beforeEach(function () {
    sandbox.useFakeTimers();
  });

  after(function () {
    sandbox.restore();
  });

  describe("getBestHead and getBestPeer", () => {
    let metastoreStub: StubbedIPeerMetadataStore;

    beforeEach(function () {
      metastoreStub = getStubbedMetadataStore();
    });

    it("should get best head and best peer", async () => {
      const peer1 = await PeerId.create();
      const peer2 = await PeerId.create();
      const peer3 = await PeerId.create();
      const peer4 = await PeerId.create();
      const peers = [peer1, peer2, peer3, peer4];
      metastoreStub.status.get.withArgs(peer1).returns({
        forkDigest: Buffer.alloc(0),
        finalizedRoot: Buffer.alloc(0),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32, 1),
        headSlot: 1000,
      });
      metastoreStub.status.get.withArgs(peer2).returns({
        forkDigest: Buffer.alloc(0),
        finalizedRoot: Buffer.alloc(0),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32, 2),
        headSlot: 2000,
      });
      metastoreStub.status.get.withArgs(peer3).returns({
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
    let metastoreStub: StubbedIPeerMetadataStore;
    let peerScoreStub: SinonStubbedInstance<IPeerRpcScoreStore>;

    beforeEach(() => {
      metastoreStub = getStubbedMetadataStore();
      networkStub = sinon.createStubInstance(Network);
      networkStub.peerMetadata = metastoreStub;
      forkChoiceStub = sinon.createStubInstance(ForkChoice) as SinonStubbedInstance<ForkChoice> & ForkChoice;
      peerScoreStub = sinon.createStubInstance(PeerRpcScoreStore);
      networkStub.peerRpcScores = peerScoreStub;
    });
    afterEach(() => {
      sinon.restore();
    });
    it("should return false, no peer", function () {
      networkStub.getConnectedPeers.returns([]);
      expect(checkBestPeer(null!, forkChoiceStub, networkStub)).to.be.false;
    });

    it("peer is disconnected", async function () {
      const peer1 = await PeerId.create();
      networkStub.getConnectedPeers.returns([]);
      expect(checkBestPeer(peer1, forkChoiceStub, networkStub)).to.be.false;
      expect(networkStub.getConnectedPeers.calledOnce).to.be.true;
      expect(forkChoiceStub.getHead.calledOnce).to.be.false;
    });

    it("peer is connected but no status", async function () {
      const peer1 = await PeerId.create();
      networkStub.getConnectedPeers.returns([peer1]);
      expect(checkBestPeer(peer1, forkChoiceStub, networkStub)).to.be.false;
      expect(networkStub.getConnectedPeers.calledOnce).to.be.true;
      expect(forkChoiceStub.getHead.calledOnce).to.be.false;
    });

    it("not enough peer score", async function () {
      const peer1 = await PeerId.create();
      networkStub.getConnectedPeers.returns([peer1]);
      forkChoiceStub.getHead.returns(generateBlockSummary({slot: 20}));
      peerScoreStub.getScoreState.returns(ScoreState.Banned);
      expect(checkBestPeer(peer1, forkChoiceStub, networkStub)).to.be.false;
      expect(networkStub.getConnectedPeers.calledOnce).to.be.true;
      expect(peerScoreStub.getScoreState.calledOnce).to.be.true;
      expect(forkChoiceStub.getHead.calledOnce).to.be.false;
    });

    it("peer head slot is not better than us", async function () {
      const peer1 = await PeerId.create();
      networkStub.getConnectedPeers.returns([peer1]);
      metastoreStub.status.get.withArgs(peer1).returns({
        finalizedEpoch: 0,
        finalizedRoot: Buffer.alloc(0),
        forkDigest: Buffer.alloc(0),
        headRoot: ZERO_HASH,
        headSlot: 10,
      });
      forkChoiceStub.getHead.returns(generateBlockSummary({slot: 20}));
      peerScoreStub.getScoreState.returns(ScoreState.Healthy);
      expect(checkBestPeer(peer1, forkChoiceStub, networkStub)).to.be.false;
      expect(networkStub.getConnectedPeers.calledOnce).to.be.true;
      expect(peerScoreStub.getScoreState.calledOnce).to.be.true;
      expect(forkChoiceStub.getHead.calledOnce).to.be.true;
    });

    it("peer is good for best peer", async function () {
      const peer1 = await PeerId.create();
      networkStub.getConnectedPeers.returns([peer1]);
      metastoreStub.status.get.withArgs(peer1).returns({
        finalizedEpoch: 0,
        finalizedRoot: Buffer.alloc(0),
        forkDigest: Buffer.alloc(0),
        headRoot: ZERO_HASH,
        headSlot: 30,
      });
      peerScoreStub.getScoreState.returns(ScoreState.Healthy);
      forkChoiceStub.getHead.returns(generateBlockSummary({slot: 20}));
      expect(checkBestPeer(peer1, forkChoiceStub, networkStub)).to.be.true;
      expect(networkStub.getConnectedPeers.calledOnce).to.be.true;
      expect(peerScoreStub.getScoreState.calledOnce).to.be.true;
      expect(forkChoiceStub.getHead.calledOnce).to.be.true;
    });
  });
});
