import {PeerId} from "@libp2p/interface-peer-id";
import {expect} from "chai";
import sinon from "sinon";
import {
  RateLimiterModules,
  InboundRateLimiter,
  defaultRateLimiterOpts,
} from "../../../../src/network/reqresp/inboundRateLimiter.js";
import {createStubbedLogger} from "../../../utils/mocks/logger.js";

describe("InboundRateLimiter", () => {
  const peer1 = {toString: () => "peer1"} as PeerId;
  const peer2 = {toString: () => "peer2"} as PeerId;

  let rateLimiter: InboundRateLimiter;
  const limits = {
    requestCountPeerLimit: 100,
    blockCountPeerLimit: 100,
    blockCountTotalLimit: 500,
    rateTrackerTimeoutMs: 60 * 1000, // 1 minute
  };
  let modules: RateLimiterModules;
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    modules = {
      logger: createStubbedLogger(),
      reportPeer: sinon.stub(),
      metrics: ({reqResp: {rateLimitErrors: {inc: sinon.stub()}}} as unknown) as RateLimiterModules["metrics"],
    };
    rateLimiter = new InboundRateLimiter(limits, modules);
    sandbox.useFakeTimers();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("constructor()", () => {
    it("should set options", () => {
      expect(rateLimiter["options"]).to.be.deep.equal(limits);
    });

    it("should set the default options if none provided", () => {
      rateLimiter = new InboundRateLimiter({}, modules);
      expect(rateLimiter["options"]).to.be.deep.equal(defaultRateLimiterOpts);
    });

    it("should set the missing options to default", () => {
      rateLimiter = new InboundRateLimiter(
        {requestCountPeerLimit: limits.requestCountPeerLimit, blockCountPeerLimit: limits.blockCountPeerLimit},
        modules
      );

      expect(rateLimiter["options"]).to.be.deep.equal({
        ...defaultRateLimiterOpts,
        requestCountPeerLimit: limits.requestCountPeerLimit,
        blockCountPeerLimit: limits.blockCountPeerLimit,
      });
    });
  });

  describe("allowRequest()", () => {
    it("should allow requests within limit for peers", () => {
      for (let i = 0; i < limits.requestCountPeerLimit; i++) {
        expect(rateLimiter.allowRequest(peer1)).to.be.true;
        expect(rateLimiter.allowRequest(peer2)).to.be.true;
      }
    });

    it("should deny requests when limit reaches for peers", () => {
      for (let i = 0; i < limits.requestCountPeerLimit; i++) {
        rateLimiter.allowRequest(peer1);
      }
      expect(rateLimiter.allowRequest(peer1)).to.be.false;
      expect(rateLimiter.allowRequest(peer2)).to.be.true;
    });

    it("should allow request for peer after the limit time", () => {
      for (let i = 0; i < limits.requestCountPeerLimit; i++) {
        rateLimiter.allowRequest(peer1);
      }
      expect(rateLimiter.allowRequest(peer1)).to.be.false;
      sandbox.clock.tick(limits.rateTrackerTimeoutMs);
      expect(rateLimiter.allowRequest(peer1)).to.be.true;
    });

    it("should report peer if request limit reached", () => {
      for (let i = 0; i < limits.requestCountPeerLimit; i++) {
        rateLimiter.allowRequest(peer1);
        rateLimiter.allowRequest(peer2);
      }
      rateLimiter.allowRequest(peer1);
      rateLimiter.allowRequest(peer2);
      expect(modules.reportPeer).to.be.calledTwice;
      expect(modules.reportPeer).to.be.calledWith(peer1);
      expect(modules.reportPeer).to.be.calledWith(peer2);
    });

    it("should inc metric if request limit reached", () => {
      for (let i = 0; i < limits.requestCountPeerLimit; i++) {
        rateLimiter.allowRequest(peer1);
        rateLimiter.allowRequest(peer2);
      }
      rateLimiter.allowRequest(peer1);
      rateLimiter.allowRequest(peer2);
      expect(modules.metrics?.reqResp.rateLimitErrors.inc).to.be.calledTwice;
      expect(modules.metrics?.reqResp.rateLimitErrors.inc).to.be.calledWithExactly({
        tracker: "requestCountPeerTracker",
      });
    });
  });

  describe("allowBlockByRequest()", () => {
    it("should allow requests within limit for peers", () => {
      expect(rateLimiter.allowBlockByRequest(peer1, limits.blockCountPeerLimit)).to.be.true;
      expect(rateLimiter.allowBlockByRequest(peer2, limits.blockCountPeerLimit)).to.be.true;
    });

    it("should deny requests when limit reaches for peers", () => {
      rateLimiter.allowBlockByRequest(peer1, limits.blockCountPeerLimit);
      rateLimiter.allowBlockByRequest(peer2, limits.blockCountPeerLimit - 1);

      expect(rateLimiter.allowBlockByRequest(peer1, 1)).to.be.false;
      expect(rateLimiter.allowBlockByRequest(peer2, 1)).to.be.true;
    });

    it("should allow request for peer after the limit time", () => {
      rateLimiter.allowBlockByRequest(peer1, limits.blockCountPeerLimit);
      expect(rateLimiter.allowBlockByRequest(peer1, 1)).to.be.false;
      sandbox.clock.tick(limits.rateTrackerTimeoutMs);
      expect(rateLimiter.allowBlockByRequest(peer1, 1)).to.be.true;
    });

    it("should report peer if request limit reached", () => {
      rateLimiter.allowBlockByRequest(peer1, limits.blockCountPeerLimit);
      rateLimiter.allowBlockByRequest(peer1, 1);
      rateLimiter.allowBlockByRequest(peer2, limits.blockCountPeerLimit);
      rateLimiter.allowBlockByRequest(peer2, 1);

      expect(modules.reportPeer).to.be.calledTwice;
      expect(modules.reportPeer).to.be.calledWith(peer1);
      expect(modules.reportPeer).to.be.calledWith(peer2);
    });

    it("should inc metric if request limit reached", () => {
      rateLimiter.allowBlockByRequest(peer1, limits.blockCountPeerLimit);
      rateLimiter.allowBlockByRequest(peer1, 1);
      rateLimiter.allowBlockByRequest(peer2, limits.blockCountPeerLimit);
      rateLimiter.allowBlockByRequest(peer2, 1);

      expect(modules.metrics?.reqResp.rateLimitErrors.inc).to.be.calledTwice;
      expect(modules.metrics?.reqResp.rateLimitErrors.inc).to.be.calledWithExactly({
        tracker: "blockCountPeerTracker",
      });
    });

    it("should deny peer request if total block request limit reached", () => {
      rateLimiter = new InboundRateLimiter({...limits, blockCountTotalLimit: 5}, modules);
      rateLimiter.allowBlockByRequest(peer1, 5);
      expect(rateLimiter.allowBlockByRequest(peer1, 1)).to.be.false;
    });

    it("should inc metric if total block request limit reached", () => {
      rateLimiter = new InboundRateLimiter({...limits, blockCountTotalLimit: 5}, modules);
      rateLimiter.allowBlockByRequest(peer1, 5);
      rateLimiter.allowBlockByRequest(peer1, 1);
      rateLimiter.allowBlockByRequest(peer2, 1);

      expect(modules.metrics?.reqResp.rateLimitErrors.inc).to.be.calledTwice;
      expect(modules.metrics?.reqResp.rateLimitErrors.inc).to.be.calledWithExactly({
        tracker: "blockCountTotalTracker",
      });
    });
  });

  describe("prune", () => {
    it("should reset request rate limit for a peer", () => {
      for (let i = 0; i < limits.requestCountPeerLimit; i++) {
        rateLimiter.allowRequest(peer1);
        rateLimiter.allowRequest(peer2);
      }
      expect(rateLimiter.allowRequest(peer1)).to.be.false;
      expect(rateLimiter.allowRequest(peer2)).to.be.false;

      rateLimiter.prune(peer1);

      expect(rateLimiter.allowRequest(peer1)).to.be.true;
      expect(rateLimiter.allowRequest(peer2)).to.be.false;
    });

    it("should reset block request rate limit for a peer", () => {
      rateLimiter.allowBlockByRequest(peer1, limits.blockCountPeerLimit);
      rateLimiter.allowBlockByRequest(peer2, limits.blockCountPeerLimit);
      expect(rateLimiter.allowBlockByRequest(peer1, 1)).to.be.false;
      expect(rateLimiter.allowBlockByRequest(peer2, 1)).to.be.false;

      rateLimiter.prune(peer1);

      expect(rateLimiter.allowBlockByRequest(peer1, 1)).to.be.true;
      expect(rateLimiter.allowBlockByRequest(peer2, 1)).to.be.false;
    });
  });
});
