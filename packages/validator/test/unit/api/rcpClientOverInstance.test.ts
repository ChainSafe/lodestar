import sinon, {SinonFakeTimers, SinonSandbox} from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {LodestarEventIterator} from "@chainsafe/lodestar-utils";

import {ApiClientOverInstance} from "../../../src/api";
import {RestEventsApi} from "../../../src/api/impl/rest/events/events";
import {MockBeaconApi} from "../../utils/mocks/beacon";
import {MockNodeApi} from "../../utils/mocks/node";
import {MockValidatorApi} from "../../utils/mocks/validator";
import {testLogger} from "../../utils/logger";
import {ClockEventType} from "../../../src/api/interface/clock";
import {MockConfigApi} from "../../utils/mocks/config";

describe("RpcClientOverInstance test", function () {
  let clock: SinonFakeTimers, sandbox: SinonSandbox;

  before(() => {
    sandbox = sinon.createSandbox();
  });

  after(() => {
    sandbox.restore();
  });

  beforeEach(() => {
    clock = sandbox.useFakeTimers(Date.now());
  });

  afterEach(() => {
    clock.restore();
  });

  function getRpcClient(): ApiClientOverInstance {
    const events = sinon.createStubInstance(RestEventsApi);
    events.getEventStream.returns(
      new LodestarEventIterator(() => {
        return;
      })
    );
    return new ApiClientOverInstance({
      config,
      beacon: new MockBeaconApi({
        genesisTime: Math.floor(Date.now() / 1000),
      }),
      node: new MockNodeApi(),
      validator: new MockValidatorApi(),
      events,
      logger: testLogger(),
      configApi: new MockConfigApi({config}),
    });
  }

  it("should not notify new slot because has not yet come", async function () {
    const rpcClient = getRpcClient();
    const cb = sandbox.spy();
    await rpcClient.connect();
    rpcClient.on(ClockEventType.CLOCK_SLOT, cb);
    expect(cb.notCalled).to.be.true;
    rpcClient.off(ClockEventType.CLOCK_SLOT, cb);
  });

  it("should properly notify on new slot", async function () {
    const rpcClient = getRpcClient();
    const cb = sandbox.spy();
    await Promise.all([rpcClient.connect(), clock.tickAsync(3000)]);
    rpcClient.on(ClockEventType.CLOCK_SLOT, cb);
    const slotEvent = new Promise((resolve) => {
      rpcClient.on(ClockEventType.CLOCK_SLOT, resolve);
    });
    clock.tick((config.params.SECONDS_PER_SLOT + 1) * 1000);
    await slotEvent;
    expect(cb.withArgs({slot: 1}).called).to.be.true;
  });

  it("should properly notify on next slot", async function () {
    const rpcClient = getRpcClient();
    const cb = sandbox.spy();
    rpcClient.on(ClockEventType.CLOCK_SLOT, cb);
    await Promise.all([rpcClient.connect(), clock.tickAsync(3000)]);
    clock.tick((config.params.SECONDS_PER_SLOT + 1) * 1000);
    clock.tick((config.params.SECONDS_PER_SLOT + 1) * 1000);
    expect(cb.withArgs({slot: 1}).called).to.be.true;
    expect(cb.withArgs({slot: 2}).called).to.be.true;
  });

  it("should not notify new epoch because has not yet come", async function () {
    const rpcClient = getRpcClient();
    const cb = sandbox.spy();
    rpcClient.on(ClockEventType.CLOCK_EPOCH, cb);
    await Promise.all([rpcClient.connect(), clock.tickAsync(3000)]);
    clock.tick((config.params.SLOTS_PER_EPOCH - 1) * config.params.SECONDS_PER_SLOT * 1000);
    expect(cb.notCalled).to.be.true;
  });

  it("should properly notify on new epoch", async function () {
    const rpcClient = getRpcClient();
    const cb = sandbox.spy();
    rpcClient.on(ClockEventType.CLOCK_EPOCH, cb);
    await Promise.all([rpcClient.connect(), clock.tickAsync(3000)]);
    clock.tick((config.params.SLOTS_PER_EPOCH + 1) * config.params.SECONDS_PER_SLOT * 1000);
    expect(cb.withArgs({epoch: 1}).called).to.be.true;
  });

  it("should properly notify on subsequent epoch", async function () {
    const rpcClient = getRpcClient();
    const cb = sandbox.spy();
    rpcClient.on(ClockEventType.CLOCK_EPOCH, cb);
    await Promise.all([rpcClient.connect(), clock.tickAsync(3000)]);
    clock.tick((config.params.SLOTS_PER_EPOCH + 1) * config.params.SECONDS_PER_SLOT * 1000);
    clock.tick((config.params.SLOTS_PER_EPOCH + 1) * config.params.SECONDS_PER_SLOT * 1000);
    expect(cb.withArgs({epoch: 1}).called).to.be.true;
    expect(cb.withArgs({epoch: 2}).called).to.be.true;
  });
});
