import {ChainEventEmitter} from "../../../../src/chain";
import {EventEmitter} from "events";
import {SinonStubbedInstance} from "sinon";
import {RateCounter} from "../../../../src/sync/stats/rate";
import {SyncStats} from "../../../../src/sync/stats";
import {expect} from "chai";
import sinon from "sinon";

describe("sync stats", function () {

  let chainEventStub: ChainEventEmitter, rateCounterStub: SinonStubbedInstance<RateCounter>;

  beforeEach(function () {
    chainEventStub = new EventEmitter();
    rateCounterStub = sinon.createStubInstance(RateCounter);
  });

  it("should get correct sync speed", function () {
    const stats = new SyncStats(chainEventStub, rateCounterStub as unknown as RateCounter);
    rateCounterStub.rate.returns(15.897);
    expect(stats.getSyncSpeed()).to.equal(15.9);
  });

  it("should get estimate if synced", function () {
    const stats = new SyncStats(chainEventStub, rateCounterStub as unknown as RateCounter);
    expect(stats.getEstimate(0, 0)).to.equal(0);
  });

  it("should get estimate if sync speed 0", function () {
    const stats = new SyncStats(chainEventStub, rateCounterStub as unknown as RateCounter);
    rateCounterStub.rate.returns(0);
    expect(stats.getEstimate(0, 1)).to.equal(Infinity);
  });

  it("should get estimate", function () {
    const stats = new SyncStats(chainEventStub, rateCounterStub as unknown as RateCounter);
    rateCounterStub.rate.returns(0.5);
    expect(stats.getEstimate(0, 1)).to.equal(2);
  });

});
