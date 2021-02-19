import {RpcScoreEvent, SimpleRpcScoreTracker} from "../../../../../src/network/peers/score";
import PeerId from "peer-id";
import {expect} from "chai";
import {getStubbedMetadataStore, StubbedIPeerMetadataStore} from "../../../../utils/peer";

describe("simple block provider score tracking", function () {
  const peer = PeerId.createFromB58String("Qma9T5YraSnpRDZqRR4krcSJabThc8nwZuJV3LercPHufi");

  let storeStub: StubbedIPeerMetadataStore;

  beforeEach(function () {
    storeStub = getStubbedMetadataStore();
  });

  it("should return default score", function () {
    const scoreTracker = new SimpleRpcScoreTracker(storeStub);
    const score = scoreTracker.getScore(peer);
    expect(score).to.be.equal(100);
  });

  it("should return real score", function () {
    const scoreTracker = new SimpleRpcScoreTracker(storeStub);
    storeStub.rpcScore.get.returns(50);
    const score = scoreTracker.getScore(peer);
    expect(score).to.be.equal(50);
    expect(storeStub.rpcScore.get.withArgs(peer).calledOnce).to.be.true;
  });

  it("should reset peer score", function () {
    const scoreTracker = new SimpleRpcScoreTracker(storeStub);
    scoreTracker.reset(peer);
    expect(storeStub.rpcScore.set.withArgs(peer, 100).calledOnce).to.be.true;
  });

  it("should update peer score", function () {
    const scoreTracker = new SimpleRpcScoreTracker(storeStub);
    scoreTracker.update(peer, RpcScoreEvent.SUCCESS_BLOCK_RANGE);
    expect(storeStub.rpcScore.set.withArgs(peer, 110).calledOnce).to.be.true;
  });

  it("should not go above max score", function () {
    const scoreTracker = new SimpleRpcScoreTracker(storeStub);
    storeStub.rpcScore.get.returns(200);
    scoreTracker.update(peer, RpcScoreEvent.SUCCESS_BLOCK_RANGE);
    expect(storeStub.rpcScore.set.withArgs(peer, 200).calledOnce).to.be.true;
  });

  it("should not go belove min score", function () {
    const scoreTracker = new SimpleRpcScoreTracker(storeStub);
    storeStub.rpcScore.get.returns(0);
    scoreTracker.update(peer, RpcScoreEvent.UNKNOWN_ERROR);
    expect(storeStub.rpcScore.set.withArgs(peer, 0).calledOnce).to.be.true;
  });
});
