import {describe, it} from "mocha";
import {LocalClock} from "../../../../src/chain/clock/local/LocalClock";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, { SinonFakeTimers } from "sinon";
import {expect} from "chai";

describe("LocalClock", function() {

  let realClock: SinonFakeTimers;

  beforeEach(() => {
    realClock = sinon.useFakeTimers();
  });

  afterEach(() => {
    realClock.restore();
  });

  it("Should notify on new slot", async function () {
    const clock = new LocalClock(config, Math.round(new Date().getTime() / 1000));
    const spy = sinon.spy();
    clock.onNewSlot(spy);
    await clock.start();
    realClock.tick(config.params.SECONDS_PER_SLOT * 1000);
    expect(spy.calledOnce).to.be.true;
    await clock.stop();
  });

  it("Should notify on new epoch", async function () {
    const clock = new LocalClock(config, Math.round(new Date().getTime() / 1000));
    const spy = sinon.spy();
    clock.onNewEpoch(spy);
    await clock.start();
    realClock.tick(config.params.SLOTS_PER_EPOCH * config.params.SECONDS_PER_SLOT * 1000);
    expect(spy.calledOnce).to.be.true;
    await clock.stop();
  });

});