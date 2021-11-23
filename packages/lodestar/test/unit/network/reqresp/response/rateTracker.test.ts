import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import PeerId from "peer-id";
import sinon, {SinonStubbedInstance} from "sinon";
import {IPeerRpcScoreStore, PeerRpcScoreStore} from "../../../../../src/network";
import {defaultNetworkOptions} from "../../../../../src/network/options";
import {RateTracker, ReqRespRateTracker} from "../../../../../src/network/reqresp/response/rateTracker";

describe("RateTracker", () => {
  let rateTracker: RateTracker;
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    rateTracker = new RateTracker(500, 60 * 1000);
    sandbox.useFakeTimers();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should request objects up to limit", () => {
    expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(0);
    expect(rateTracker.requestObjects(300)).to.be.equal(300);
    expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(300);
    expect(rateTracker.requestObjects(300)).to.be.equal(300);
    expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(600);
    expect(rateTracker.requestObjects(100)).to.be.equal(0);
    expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(600);
    sandbox.clock.tick(60 * 1000);
    expect(rateTracker.requestObjects(100)).to.be.equal(100);
    expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(100);
    expect(rateTracker.requestObjects(400)).to.be.equal(400);
    expect(rateTracker.getRequestedObjectsWithinWindow()).to.be.equal(500);
  });
});

describe("ReqRespRateTracker", () => {
  let rateTracker: ReqRespRateTracker;
  const sandbox = sinon.createSandbox();
  let peerRpcScoresStub: IPeerRpcScoreStore & SinonStubbedInstance<PeerRpcScoreStore>;

  beforeEach(() => {
    peerRpcScoresStub = sandbox.createStubInstance(PeerRpcScoreStore) as IPeerRpcScoreStore &
      SinonStubbedInstance<PeerRpcScoreStore>;
    rateTracker = new ReqRespRateTracker(defaultNetworkOptions, {
      logger: new WinstonLogger(),
      peerRpcScores: peerRpcScoresStub,
    });
    sandbox.useFakeTimers();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("requestCountTotalLimit", async () => {
    for (let i = 0; i < defaultNetworkOptions.requestCountTotalLimit; i++) {
      expect(rateTracker.requestBlocksForPeerId(await PeerId.create(), 1)).to.be.equal(1);
    }
    expect(rateTracker.requestBlocksForPeerId(await PeerId.create(), 1)).to.be.equal(0);
    expect(peerRpcScoresStub.applyAction.calledOnce).to.be.false;

    sandbox.clock.tick(60 * 1000);

    expect(rateTracker.requestBlocksForPeerId(await PeerId.create(), 1)).to.be.equal(1);
  });

  it("requestCountPeerLimit", async () => {
    const peerId = await PeerId.create();
    for (let i = 0; i < defaultNetworkOptions.requestCountPeerLimit; i++) {
      expect(rateTracker.requestBlocksForPeerId(peerId, 1)).to.be.equal(1);
    }
    const peerId2 = await PeerId.create();
    // it's ok to request blocks for another peer
    expect(rateTracker.requestBlocksForPeerId(peerId2, 1)).to.be.equal(1);
    expect(peerRpcScoresStub.applyAction.calledOnce).to.be.false;
    // not ok for the same peer id as it reached the limit
    expect(rateTracker.requestBlocksForPeerId(peerId, 1)).to.be.equal(0);
    // this peer id abuses us
    expect(peerRpcScoresStub.applyAction.calledOnce).to.be.true;

    sandbox.clock.tick(60 * 1000);
    // try again after timeout
    expect(rateTracker.requestBlocksForPeerId(peerId, 1)).to.be.equal(1);
  });

  it("blockCountTotalTracker", async () => {
    const blockCount = Math.floor(defaultNetworkOptions.blockCountTotalLimit / 2);
    for (let i = 0; i < 2; i++) {
      expect(rateTracker.requestBlocksForPeerId(await PeerId.create(), blockCount)).to.be.equal(blockCount);
    }
    expect(rateTracker.requestBlocksForPeerId(await PeerId.create(), 1)).to.be.equal(0);
    expect(peerRpcScoresStub.applyAction.calledOnce).to.be.false;

    sandbox.clock.tick(60 * 1000);
    // try again after timeout
    expect(rateTracker.requestBlocksForPeerId(await PeerId.create(), 1)).to.be.equal(1);
  });

  it("blockCountPeerLimit", async () => {
    const blockCount = Math.floor(defaultNetworkOptions.blockCountPeerLimit / 2);
    const peerId = await PeerId.create();
    for (let i = 0; i < 2; i++) {
      expect(rateTracker.requestBlocksForPeerId(peerId, blockCount)).to.be.equal(blockCount);
    }
    const peerId2 = await PeerId.create();
    // it's ok to request blocks for another peer
    expect(rateTracker.requestBlocksForPeerId(peerId2, 1)).to.be.equal(1);
    // not ok for the same peer id as it reached the limit
    expect(rateTracker.requestBlocksForPeerId(peerId, 1)).to.be.equal(0);
    // this peer id abuses us
    expect(peerRpcScoresStub.applyAction.calledOnce).to.be.true;

    sandbox.clock.tick(60 * 1000);
    // try again after timeout
    expect(rateTracker.requestBlocksForPeerId(peerId, 1)).to.be.equal(1);
  });
});
