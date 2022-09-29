import {expect} from "chai";
import {PeerId} from "@libp2p/interface-peer-id";
import sinon, {SinonStubbedInstance} from "sinon";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {IPeerRpcScoreStore, PeerAction, PeerRpcScoreStore} from "../../../../../src/network/index.js";
import {defaultNetworkOptions} from "../../../../../src/network/options.js";
import {InboundRateLimiter} from "../../../../../src/network/reqresp/response/rateLimiter.js";
import {Method, RequestTypedContainer} from "../../../../../src/network/reqresp/types.js";
import {testLogger} from "../../../../utils/logger.js";

describe("ResponseRateLimiter", () => {
  const logger = testLogger();
  let inboundRateLimiter: InboundRateLimiter;
  const sandbox = sinon.createSandbox();
  let peerRpcScoresStub: IPeerRpcScoreStore & SinonStubbedInstance<PeerRpcScoreStore>;

  beforeEach(() => {
    peerRpcScoresStub = sandbox.createStubInstance(PeerRpcScoreStore) as IPeerRpcScoreStore &
      SinonStubbedInstance<PeerRpcScoreStore>;
    inboundRateLimiter = new InboundRateLimiter(defaultNetworkOptions, {
      logger,
      peerRpcScores: peerRpcScoresStub,
      metrics: null,
    });
    sandbox.useFakeTimers();
  });

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * Steps:
   * - Peer1 requests 50 times within 1 minute => ok
   * - Peer2 requests 1 time => ok
   * - Peer1 requests again => NOT ok, penalty applied
   * - Tick 1 minute
   * - Peer1 requests again => ok
   */
  it("requestCountPeerLimit", async () => {
    const peerId = await createSecp256k1PeerId();
    const requestTyped = {method: Method.Ping, body: BigInt(1)} as RequestTypedContainer;
    for (let i = 0; i < defaultNetworkOptions.requestCountPeerLimit; i++) {
      expect(inboundRateLimiter.allowRequest(peerId, requestTyped)).to.equal(true);
    }
    const peerId2 = await createSecp256k1PeerId();
    // it's ok to request blocks for another peer
    expect(inboundRateLimiter.allowRequest(peerId2, requestTyped)).to.equal(true);
    expect(peerRpcScoresStub.applyAction).not.to.be.calledOnce;
    // not ok for the same peer id as it reached the limit
    expect(inboundRateLimiter.allowRequest(peerId, requestTyped)).to.equal(false);
    // this peer id abuses us
    expect(peerRpcScoresStub.applyAction, "peer1 is banned due to requestCountPeerLimit").to.be.calledOnceWith(
      peerId,
      PeerAction.Fatal,
      sinon.match.any
    );

    sandbox.clock.tick(60 * 1000);
    // try again after timeout
    expect(inboundRateLimiter.allowRequest(peerId, requestTyped)).to.equal(true);
  });

  /**
   * Steps (given block count total limit 2000):
   * - Peer1 requests 1000 blocks => ok
   * - Peer2 requests 1000 blocks => ok
   * - Another peer requests 1 block => NOT ok, no penalty applied
   * - Tick 1 minute
   * - Another peer requests 1 block => ok
   */
  it("blockCountTotalTracker", async () => {
    const blockCount = Math.floor(defaultNetworkOptions.blockCountTotalLimit / 2);
    const requestTyped = {method: Method.BeaconBlocksByRange, body: {count: blockCount}} as RequestTypedContainer;
    for (let i = 0; i < 2; i++) {
      expect(inboundRateLimiter.allowRequest(await createSecp256k1PeerId(), requestTyped)).to.equal(true);
    }

    const oneBlockRequestTyped = {method: Method.BeaconBlocksByRoot, body: [Buffer.alloc(32)]} as RequestTypedContainer;

    expect(inboundRateLimiter.allowRequest(await createSecp256k1PeerId(), oneBlockRequestTyped)).to.equal(false);
    expect(peerRpcScoresStub.applyAction).not.to.be.calledOnce;

    sandbox.clock.tick(60 * 1000);
    // try again after timeout
    expect(inboundRateLimiter.allowRequest(await createSecp256k1PeerId(), oneBlockRequestTyped)).to.equal(true);
  });

  /**
   * Steps (given default block count peer limit 500):
   * - Peer1 requests 250 blocks => ok
   * - Peer1 requests 250 blocks => ok
   * - Peer2 requests 1 block => ok
   * - Peer1 requests 1 block => NOT ok, apply penalty
   * - Tick 1 minute
   * - Peer1 request 1 block => ok
   */
  it("blockCountPeerLimit", async () => {
    const blockCount = Math.floor(defaultNetworkOptions.blockCountPeerLimit / 2);
    const requestTyped = {method: Method.BeaconBlocksByRange, body: {count: blockCount}} as RequestTypedContainer;
    const peerId = await createSecp256k1PeerId();
    for (let i = 0; i < 2; i++) {
      expect(inboundRateLimiter.allowRequest(peerId, requestTyped)).to.equal(true);
    }
    const peerId2 = await createSecp256k1PeerId();
    const oneBlockRequestTyped = {method: Method.BeaconBlocksByRoot, body: [Buffer.alloc(32)]} as RequestTypedContainer;
    // it's ok to request blocks for another peer
    expect(inboundRateLimiter.allowRequest(peerId2, oneBlockRequestTyped)).to.equal(true);
    // not ok for the same peer id as it reached the limit
    expect(inboundRateLimiter.allowRequest(peerId, oneBlockRequestTyped)).to.equal(false);
    // this peer id abuses us
    expect(
      peerRpcScoresStub.applyAction.calledOnceWith(peerId, PeerAction.Fatal, sinon.match.any),
      "peer1 is banned due to blockCountPeerLimit"
    ).to.equal(true);

    sandbox.clock.tick(60 * 1000);
    // try again after timeout
    expect(inboundRateLimiter.allowRequest(peerId, oneBlockRequestTyped)).to.equal(true);
  });

  it("should remove rate tracker for disconnected peers", async () => {
    const peerId = await createSecp256k1PeerId();
    const pruneStub = sandbox.stub(inboundRateLimiter, "pruneByPeerIdStr" as keyof InboundRateLimiter);
    inboundRateLimiter.start();
    const requestTyped = {method: Method.Ping, body: BigInt(1)} as RequestTypedContainer;
    expect(inboundRateLimiter.allowRequest(peerId, requestTyped)).to.equal(true);

    // no request is made in 5 minutes
    sandbox.clock.tick(5 * 60 * 1000);
    expect(pruneStub).not.to.be.calledOnce;
    // wait for 5 more minutes for the timer to run
    sandbox.clock.tick(5 * 60 * 1000);
    expect(pruneStub, "prune is not called").to.be.calledOnce;
  });

  it.skip("rateLimiter memory usage", async function () {
    this.timeout(5000);
    const peerIds: PeerId[] = [];
    for (let i = 0; i < 25; i++) {
      peerIds.push(await createSecp256k1PeerId());
    }

    const startMem = process.memoryUsage().heapUsed;

    const rateLimiter = new InboundRateLimiter(defaultNetworkOptions, {
      logger,
      peerRpcScores: peerRpcScoresStub,
      metrics: null,
    });
    const requestTyped = {method: Method.BeaconBlocksByRoot, body: [Buffer.alloc(32)]} as RequestTypedContainer;
    // Make it full: every 1/2s add a new request for all peers
    for (let i = 0; i < 1000; i++) {
      for (const peerId of peerIds) {
        rateLimiter.allowRequest(peerId, requestTyped);
      }
      sandbox.clock.tick(500);
    }

    const memUsage = process.memoryUsage().heapUsed - startMem;
    expect(memUsage).to.be.lt(15000000, "memory used for rate limiter should be less than 15MB");
  });
});
