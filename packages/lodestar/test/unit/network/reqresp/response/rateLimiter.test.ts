import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import PeerId from "peer-id";
import sinon, {SinonStubbedInstance} from "sinon";
import {IPeerRpcScoreStore, PeerRpcScoreStore} from "../../../../../src/network";
import {defaultNetworkOptions} from "../../../../../src/network/options";
import {InboundRateLimiter} from "../../../../../src/network/reqresp/response/rateLimiter";

describe("ResponseRateLimiter", () => {
  let inboundRateLimiter: InboundRateLimiter;
  const sandbox = sinon.createSandbox();
  let peerRpcScoresStub: IPeerRpcScoreStore & SinonStubbedInstance<PeerRpcScoreStore>;

  beforeEach(() => {
    peerRpcScoresStub = sandbox.createStubInstance(PeerRpcScoreStore) as IPeerRpcScoreStore &
      SinonStubbedInstance<PeerRpcScoreStore>;
    inboundRateLimiter = new InboundRateLimiter(defaultNetworkOptions, {
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
      expect(inboundRateLimiter.allowRequest(peers[i % 5])).to.be.true;
    }
    expect(inboundRateLimiter.allowRequest(await PeerId.create())).to.be.false;
    expect(peerRpcScoresStub.applyAction.calledOnce).to.be.false;

    sandbox.clock.tick(60 * 1000);

    expect(inboundRateLimiter.allowRequest(await PeerId.create())).to.be.true;
  });

  it("requestCountPeerLimit", async () => {
    const peerId = await PeerId.create();
    for (let i = 0; i < defaultNetworkOptions.requestCountPeerLimit; i++) {
      expect(inboundRateLimiter.allowRequest(peerId)).to.be.true;
    }
    const peerId2 = await PeerId.create();
    // it's ok to request blocks for another peer
    expect(inboundRateLimiter.allowRequest(peerId2)).to.be.true;
    expect(peerRpcScoresStub.applyAction.calledOnce).to.be.false;
    // not ok for the same peer id as it reached the limit
    expect(inboundRateLimiter.allowRequest(peerId)).to.be.false;
    // this peer id abuses us
    expect(peerRpcScoresStub.applyAction.calledOnce).to.be.true;

    sandbox.clock.tick(60 * 1000);
    // try again after timeout
    expect(inboundRateLimiter.allowRequest(peerId)).to.be.true;
  });

  it("blockCountTotalTracker", async () => {
    const blockCount = Math.floor(defaultNetworkOptions.blockCountTotalLimit / 2);
    for (let i = 0; i < 2; i++) {
      expect(inboundRateLimiter.allowRequest(await PeerId.create(), blockCount)).to.be.true;
    }
    expect(inboundRateLimiter.allowRequest(await PeerId.create(), 1)).to.be.false;
    expect(peerRpcScoresStub.applyAction.calledOnce).to.be.false;

    sandbox.clock.tick(60 * 1000);
    // try again after timeout
    expect(inboundRateLimiter.allowRequest(await PeerId.create(), 1)).to.be.true;
  });

  it("blockCountPeerLimit", async () => {
    const blockCount = Math.floor(defaultNetworkOptions.blockCountPeerLimit / 2);
    const peerId = await PeerId.create();
    for (let i = 0; i < 2; i++) {
      expect(inboundRateLimiter.allowRequest(peerId, blockCount)).to.be.true;
    }
    const peerId2 = await PeerId.create();
    // it's ok to request blocks for another peer
    expect(inboundRateLimiter.allowRequest(peerId2, 1)).to.be.true;
    // not ok for the same peer id as it reached the limit
    expect(inboundRateLimiter.allowRequest(peerId, 1)).to.be.false;
    // this peer id abuses us
    expect(peerRpcScoresStub.applyAction.calledOnce).to.be.true;

    sandbox.clock.tick(60 * 1000);
    // try again after timeout
    expect(inboundRateLimiter.allowRequest(peerId, 1)).to.be.true;
  });

  it.skip("rateLimiter memory usage", async function () {
    this.timeout(5000);
    const peerIds: PeerId[] = [];
    for (let i = 0; i < 25; i++) {
      peerIds.push(await PeerId.create());
    }

    const startMem = process.memoryUsage().heapUsed;

    const rateLimiter = new InboundRateLimiter(defaultNetworkOptions, {
      logger: new WinstonLogger(),
      peerRpcScores: peerRpcScoresStub,
    });
    // Make it full: every 1/2s add a new request for all peers
    for (let i = 0; i < 1000; i++) {
      for (const peerId of peerIds) {
        rateLimiter.allowRequest(peerId, 1);
      }
      sandbox.clock.tick(500);
    }

    const memUsage = process.memoryUsage().heapUsed - startMem;
    expect(memUsage).to.be.lt(15000000, "memory used for rate limiter should be less than 15MB");
  });
});
