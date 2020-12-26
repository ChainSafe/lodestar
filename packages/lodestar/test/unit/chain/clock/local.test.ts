import sinon from "sinon";
import {AbortController} from "abort-controller";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/minimal";

import {LocalClock} from "../../../../src/chain/clock/LocalClock";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter";
import {MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../../../src/constants";

describe("LocalClock", function () {
  const sandbox = sinon.createSandbox();
  let abortController: AbortController;
  let emitter: ChainEventEmitter;
  let clock: LocalClock;

  beforeEach(() => {
    sandbox.useFakeTimers();
    abortController = new AbortController();
    emitter = new ChainEventEmitter();
    clock = new LocalClock({
      config,
      emitter,
      genesisTime: Math.round(new Date().getTime() / 1000),
      signal: abortController.signal,
    });
  });

  afterEach(() => {
    sandbox.restore();
    abortController.abort();
  });

  it("Should notify on new slot", async function () {
    const spy = sinon.spy();
    emitter.on(ChainEvent.clockSlot, spy);
    sandbox.clock.tick(config.params.SECONDS_PER_SLOT * 1000);
    expect(spy.calledOnce).to.be.true;
    expect(spy.calledWith(clock.currentSlot)).to.be.true;
  });

  it("Should notify on new epoch", async function () {
    const spy = sinon.spy();
    emitter.on(ChainEvent.clockEpoch, spy);
    sandbox.clock.tick(config.params.SLOTS_PER_EPOCH * config.params.SECONDS_PER_SLOT * 1000);
    expect(spy.calledOnce).to.be.true;
    expect(spy.calledWith(clock.currentEpoch)).to.be.true;
  });

  describe("maxPeerCurrentSlot", () => {
    it("should be next slot", () => {
      sandbox.clock.tick(config.params.SECONDS_PER_SLOT * 1000 - (MAXIMUM_GOSSIP_CLOCK_DISPARITY - 50));
      expect(clock.maxPeerCurrentSlot).to.be.equal(clock.currentSlot + 1);
    });

    it("should be current slot", () => {
      expect(clock.maxPeerCurrentSlot).to.be.equal(clock.currentSlot);
    });
  });
});
