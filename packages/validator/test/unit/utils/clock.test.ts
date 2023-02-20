import sinon from "sinon";
import {expect} from "chai";
import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconConfig} from "@lodestar/config";
import {Clock, getCurrentSlotAround} from "../../../src/util/clock.js";
import {testLogger} from "../../utils/logger.js";

describe("util / Clock", function () {
  const logger = testLogger();
  let controller: AbortController;
  let fakeClock: sinon.SinonFakeTimers;

  beforeEach(() => {
    controller = new AbortController();
    fakeClock = sinon.useFakeTimers();
  });
  afterEach(() => {
    controller.abort();
    fakeClock.restore();
  });

  it("Should call on slot", async () => {
    const genesisTime = Math.floor(Date.now() / 1000) - config.SECONDS_PER_SLOT / 2;
    const clock = new Clock(config, logger, {genesisTime});

    const onSlot = sinon.stub().resolves();
    clock.runEverySlot(onSlot);
    clock.start(controller.signal);

    // Must run once immediately
    expect(onSlot.callCount).to.equal(1, "runEverySlot(cb) must be called immediately");
    expect(onSlot.getCall(0).args[0]).to.equal(0, "Wrong arg on runEverySlot(cb) call 0");

    await fakeClock.tickAsync(config.SECONDS_PER_SLOT * 1000);
    expect(onSlot.callCount).to.equal(2, "runEverySlot(cb) must be called after after slot 1");
    expect(onSlot.getCall(1).args[0]).to.equal(1, "Wrong arg on runEverySlot(cb) call 1");

    await fakeClock.tickAsync(config.SECONDS_PER_SLOT * 1000);
    expect(onSlot.callCount).to.equal(3, "runEverySlot(cb) must be called again after slot 2");
    expect(onSlot.getCall(2).args[0]).to.equal(2, "Wrong arg on runEverySlot(cb) call 2");
  });

  it("Should stop calling on slot after stop()", async () => {
    const genesisTime = Math.floor(Date.now() / 1000) - config.SECONDS_PER_SLOT / 2;
    const clock = new Clock(config, logger, {genesisTime});

    const onSlot = sinon.stub().resolves();
    clock.runEverySlot(onSlot);
    clock.start(controller.signal);

    await fakeClock.tickAsync(config.SECONDS_PER_SLOT * 1000);
    expect(onSlot.callCount).to.equal(2, "runEverySlot(cb) must be called after after slot 1");
    expect(onSlot.getCall(1).args[0]).to.equal(1, "Wrong arg on runEverySlot(cb) call 1");

    // Stop clock
    controller.abort();
    await fakeClock.tickAsync(config.SECONDS_PER_SLOT * 1000);
    expect(onSlot.callCount).to.equal(2, "runEverySlot(cb) should not be called again");
  });

  it("Should call on epoch", async () => {
    // Start halfway through an epoch, so advancing a slot does not cross to the next epoch
    const genesisTime = Math.floor(Date.now() / 1000) - (SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT) / 2;

    const clock = new Clock(config, logger, {genesisTime});

    const onEpoch = sinon.stub().resolves();
    clock.runEveryEpoch(onEpoch);
    clock.start(controller.signal);

    // Must run once immediately
    expect(onEpoch.callCount).to.equal(1, "runEverySlot(cb) must be called immediately");
    expect(onEpoch.getCall(0).args[0]).to.equal(0, "Wrong arg on runEverySlot(cb) call 0");

    await fakeClock.tickAsync(config.SECONDS_PER_SLOT * 1000);
    expect(onEpoch.callCount).to.equal(1, "runEverySlot(cb) must not be called again after a slot");

    await fakeClock.tickAsync(SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000);
    expect(onEpoch.callCount).to.equal(2, "runEverySlot(cb) must be called again after an epoch");
    expect(onEpoch.getCall(1).args[0]).to.equal(1, "Wrong arg on runEverySlot(cb) call 1");
  });

  describe("getCurrentSlot", function () {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const testConfig = {SECONDS_PER_SLOT: 12} as BeaconConfig;
    const genesisTime = Math.floor(new Date("2021-01-01").getTime() / 1000);
    const testCase: {name: string; delta: number}[] = [
      {name: "should return next slot after 11.5s", delta: 11.5},
      {name: "should return next slot after 12s", delta: 12},
      {name: "should return next slot after 12.5s", delta: 12.5},
    ];
    for (const {name, delta} of testCase) {
      it(name, async function () {
        const currentSlot = getCurrentSlotAround(testConfig, genesisTime);
        fakeClock.tick(delta * 1000);
        expect(getCurrentSlotAround(testConfig, genesisTime)).to.be.equal(currentSlot + 1, name);
      });
    }
  });
});
