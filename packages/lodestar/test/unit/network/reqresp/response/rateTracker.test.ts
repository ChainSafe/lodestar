import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import PeerId from "peer-id";
import sinon, {SinonStubbedInstance} from "sinon";
import {IPeerRpcScoreStore, PeerRpcScoreStore} from "../../../../../src/network";
import {defaultNetworkOptions} from "../../../../../src/network/options";
import {RateTracker} from "../../../../../src/network/reqresp/rateTracker";
import {ResponseRateLimiter} from "../../../../../src/network/reqresp/response/rateLimiter";

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
  let respRateLimiter: ResponseRateLimiter;
  const sandbox = sinon.createSandbox();
  let peerRpcScoresStub: IPeerRpcScoreStore & SinonStubbedInstance<PeerRpcScoreStore>;

  beforeEach(() => {
    peerRpcScoresStub = sandbox.createStubInstance(PeerRpcScoreStore) as IPeerRpcScoreStore &
      SinonStubbedInstance<PeerRpcScoreStore>;
    respRateLimiter = new ResponseRateLimiter(defaultNetworkOptions, {
      logger: new WinstonLogger(),
      peerRpcScores: peerRpcScoresStub,
    });
    sandbox.useFakeTimers();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("requestCountTotalLimit", async () => {
    // 5 peers request at the same time
    const peers = await Promise.all(Array.from({length: 5}, () => PeerId.create()));
    for (let i = 0; i < defaultNetworkOptions.requestCountTotalLimit; i++) {
      expect(respRateLimiter.allowToProcess(peers[i % 5])).to.be.true;
    }
    expect(respRateLimiter.allowToProcess(await PeerId.create())).to.be.false;
    expect(peerRpcScoresStub.applyAction.calledOnce).to.be.false;

    sandbox.clock.tick(60 * 1000);

    expect(respRateLimiter.allowToProcess(await PeerId.create())).to.be.true;
  });

  it("requestCountPeerLimit", async () => {
    const peerId = await PeerId.create();
    for (let i = 0; i < defaultNetworkOptions.requestCountPeerLimit; i++) {
      expect(respRateLimiter.allowToProcess(peerId)).to.be.true;
    }
    const peerId2 = await PeerId.create();
    // it's ok to request blocks for another peer
    expect(respRateLimiter.allowToProcess(peerId2)).to.be.true;
    expect(peerRpcScoresStub.applyAction.calledOnce).to.be.false;
    // not ok for the same peer id as it reached the limit
    expect(respRateLimiter.allowToProcess(peerId)).to.be.false;
    // this peer id abuses us
    expect(peerRpcScoresStub.applyAction.calledOnce).to.be.true;

    sandbox.clock.tick(60 * 1000);
    // try again after timeout
    expect(respRateLimiter.allowToProcess(peerId)).to.be.true;
  });

  it("blockCountTotalTracker", async () => {
    const blockCount = Math.floor(defaultNetworkOptions.blockCountTotalLimit / 2);
    for (let i = 0; i < 2; i++) {
      expect(respRateLimiter.allowToProcess(await PeerId.create(), blockCount)).to.be.true;
    }
    expect(respRateLimiter.allowToProcess(await PeerId.create(), 1)).to.be.false;
    expect(peerRpcScoresStub.applyAction.calledOnce).to.be.false;

    sandbox.clock.tick(60 * 1000);
    // try again after timeout
    expect(respRateLimiter.allowToProcess(await PeerId.create(), 1)).to.be.true;
  });

  it("blockCountPeerLimit", async () => {
    const blockCount = Math.floor(defaultNetworkOptions.blockCountPeerLimit / 2);
    const peerId = await PeerId.create();
    for (let i = 0; i < 2; i++) {
      expect(respRateLimiter.allowToProcess(peerId, blockCount)).to.be.true;
    }
    const peerId2 = await PeerId.create();
    // it's ok to request blocks for another peer
    expect(respRateLimiter.allowToProcess(peerId2, 1)).to.be.true;
    // not ok for the same peer id as it reached the limit
    expect(respRateLimiter.allowToProcess(peerId, 1)).to.be.false;
    // this peer id abuses us
    expect(peerRpcScoresStub.applyAction.calledOnce).to.be.true;

    sandbox.clock.tick(60 * 1000);
    // try again after timeout
    expect(respRateLimiter.allowToProcess(peerId, 1)).to.be.true;
  });
});
