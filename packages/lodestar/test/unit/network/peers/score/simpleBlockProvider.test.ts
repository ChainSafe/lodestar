import {BlockProviderScoreEvent, SimpleBlockProviderScoreTracker} from "../../../../../src/network/peers/score";
import PeerId from "peer-id";
import sinon, {SinonStubbedInstance} from "sinon";
import {IPeerMetadataStore, Libp2pPeerMetadataStore} from "../../../../../src/network/peers";
import {expect} from "chai";

describe("simple block provider score tracking", function () {
  const peer = PeerId.createFromB58String("Qma9T5YraSnpRDZqRR4krcSJabThc8nwZuJV3LercPHufi");

  let storeStub: SinonStubbedInstance<IPeerMetadataStore>;

  beforeEach(function () {
    storeStub = sinon.createStubInstance(Libp2pPeerMetadataStore);
  });

  it("should return default score", function () {
    const scoreTracker = new SimpleBlockProviderScoreTracker(storeStub);
    const score = scoreTracker.getScore(peer);
    expect(score).to.be.equal(100);
  });

  it("should return real score", function () {
    const scoreTracker = new SimpleBlockProviderScoreTracker(storeStub);
    storeStub.getBlockProviderScore.returns(50);
    const score = scoreTracker.getScore(peer);
    expect(score).to.be.equal(50);
    expect(storeStub.getBlockProviderScore.withArgs(peer).calledOnce).to.be.true;
  });

  it("should reset peer score", function () {
    const scoreTracker = new SimpleBlockProviderScoreTracker(storeStub);
    scoreTracker.reset(peer);
    expect(storeStub.setBlockProviderScore.withArgs(peer, 100).calledOnce).to.be.true;
  });

  it("should update peer score", function () {
    const scoreTracker = new SimpleBlockProviderScoreTracker(storeStub);
    scoreTracker.update(peer, BlockProviderScoreEvent.SUCCESS_BLOCK_RANGE);
    expect(storeStub.setBlockProviderScore.withArgs(peer, 110).calledOnce).to.be.true;
  });

  it("should not go above max score", function () {
    const scoreTracker = new SimpleBlockProviderScoreTracker(storeStub);
    storeStub.getBlockProviderScore.returns(200);
    scoreTracker.update(peer, BlockProviderScoreEvent.SUCCESS_BLOCK_RANGE);
    expect(storeStub.setBlockProviderScore.withArgs(peer, 200).calledOnce).to.be.true;
  });

  it("should not go belove min score", function () {
    const scoreTracker = new SimpleBlockProviderScoreTracker(storeStub);
    storeStub.getBlockProviderScore.returns(0);
    scoreTracker.update(peer, BlockProviderScoreEvent.UNKNOWN_ERROR);
    expect(storeStub.setBlockProviderScore.withArgs(peer, 0).calledOnce).to.be.true;
  });
});
