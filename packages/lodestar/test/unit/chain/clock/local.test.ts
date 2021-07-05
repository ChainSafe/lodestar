import sinon from "sinon";
import {AbortController} from "@chainsafe/abort-controller";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/default";

import {LocalClock} from "../../../../src/chain/clock/LocalClock";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter";
import {MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../../../src/constants";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";

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

  it("Should notify on new slot", function () {
    const spy = sinon.spy();
    emitter.on(ChainEvent.clockSlot, spy);
    sandbox.clock.tick(config.SECONDS_PER_SLOT * 1000);
    expect(spy.calledOnce).to.be.true;
    expect(spy.calledWith(clock.currentSlot)).to.be.true;
  });

  it("Should notify on new epoch", function () {
    const spy = sinon.spy();
    emitter.on(ChainEvent.clockEpoch, spy);
    sandbox.clock.tick(SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000);
    expect(spy.calledOnce).to.be.true;
    expect(spy.calledWith(clock.currentEpoch)).to.be.true;
  });

  describe("currentSlotWithGossipDisparity", () => {
    it("should be next slot", () => {
      sandbox.clock.tick(config.SECONDS_PER_SLOT * 1000 - (MAXIMUM_GOSSIP_CLOCK_DISPARITY - 50));
      expect(clock.currentSlotWithGossipDisparity).to.be.equal(clock.currentSlot + 1);
    });

    it("should be current slot", () => {
      expect(clock.currentSlotWithGossipDisparity).to.be.equal(clock.currentSlot);
    });
  });

  describe("isCurrentSlotGivenGossipDisparity", () => {
    it("should return true for current slot", () => {
      const currentSlot = clock.currentSlot;
      expect(
        clock.isCurrentSlotGivenGossipDisparity(currentSlot),
        "isCurrentSlotGivenGossipDisparity is not correct for current slot"
      ).to.be.true;
    });

    it("should accept next slot if it's too close to next slot", () => {
      const nextSlot = clock.currentSlot + 1;
      expect(
        clock.isCurrentSlotGivenGossipDisparity(nextSlot),
        "current slot could NOT be next slot if it's far away from next slot"
      ).to.be.false;
      sandbox.clock.tick(config.SECONDS_PER_SLOT * 1000 - (MAXIMUM_GOSSIP_CLOCK_DISPARITY - 50));
      expect(
        clock.isCurrentSlotGivenGossipDisparity(nextSlot),
        "current slot could be next slot if it's too close to next slot"
      ).to.be.true;
    });

    it("should accept previous slot if it's just passed current slot", () => {
      const previousSlot = clock.currentSlot - 1;
      sandbox.clock.tick(MAXIMUM_GOSSIP_CLOCK_DISPARITY - 50);
      expect(
        clock.isCurrentSlotGivenGossipDisparity(previousSlot),
        "current slot could be previous slot if it's just passed to a slot"
      ).to.be.true;
      sandbox.clock.tick(100);
      expect(
        clock.isCurrentSlotGivenGossipDisparity(previousSlot),
        "current slot could NOT be previous slot if it's far away from previous slot"
      ).to.be.false;
    });
  });
});
