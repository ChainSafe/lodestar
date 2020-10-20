import sinon, {SinonFakeTimers} from "sinon";
import {AbortController} from "abort-controller";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";

import {LocalClock} from "../../../../src/chain/clock/LocalClock";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter";

describe("LocalClock", function () {
  let realClock: SinonFakeTimers;

  beforeEach(() => {
    realClock = sinon.useFakeTimers();
  });

  afterEach(() => {
    realClock.restore();
  });

  it("Should notify on new slot", async function () {
    const emitter = new ChainEventEmitter();
    const abortController = new AbortController();
    const clock = new LocalClock({
      config,
      emitter,
      genesisTime: Math.round(new Date().getTime() / 1000),
      signal: abortController.signal,
    });
    const spy = sinon.spy();
    emitter.on(ChainEvent.clockSlot, spy);
    realClock.tick(config.params.SECONDS_PER_SLOT * 1000);
    expect(spy.calledOnce).to.be.true;
    expect(spy.calledWith(clock.currentSlot)).to.be.true;
    abortController.abort();
  });

  it("Should notify on new epoch", async function () {
    const emitter = new ChainEventEmitter();
    const abortController = new AbortController();
    const clock = new LocalClock({
      config,
      emitter,
      genesisTime: Math.round(new Date().getTime() / 1000),
      signal: abortController.signal,
    });
    const spy = sinon.spy();
    emitter.on(ChainEvent.clockEpoch, spy);
    realClock.tick(config.params.SLOTS_PER_EPOCH * config.params.SECONDS_PER_SLOT * 1000);
    expect(spy.calledOnce).to.be.true;
    expect(spy.calledWith(clock.currentEpoch)).to.be.true;
    abortController.abort();
  });
});
