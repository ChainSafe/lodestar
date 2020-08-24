import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {ApiClientOverInstance} from "../../../src/api";
import {MockBeaconApi} from "../../utils/mocks/beacon";
import {MockNodeApi} from "../../utils/mocks/node";
import {MockValidatorApi} from "../../utils/mocks/validator";
import {WinstonLogger, LogLevel} from "@chainsafe/lodestar-utils";

describe("RpcClientOverInstance test", function () {
  let clock: any, sandbox: any;

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
    return new ApiClientOverInstance({
      config,
      beacon: new MockBeaconApi({
        genesisTime: Math.floor(Date.now() / 1000),
      }),
      node: new MockNodeApi(),
      validator: new MockValidatorApi(),
      logger: new WinstonLogger({level: LogLevel.error}),
    });
  }

  it("should not notify new slot because has not yet come", async function () {
    const rpcClient = getRpcClient();
    const cb = sandbox.spy();
    await rpcClient.connect();
    rpcClient.onNewSlot(cb);
    expect(cb.notCalled).to.be.true;
  });

  it("should properly notify on new slot", async function () {
    const rpcClient = getRpcClient();
    const cb = sandbox.spy();
    rpcClient.onNewSlot(cb);
    const slotEvent = new Promise((resolve) => {
      rpcClient.onNewSlot(resolve);
    });
    await rpcClient.connect();
    clock.tick((config.params.SECONDS_PER_SLOT + 1) * 1000);
    await slotEvent;
    expect(cb.withArgs(1).called).to.be.true;
  });

  it("should properly notify on next slot", async function () {
    const rpcClient = getRpcClient();
    const cb = sandbox.spy();
    rpcClient.onNewSlot(cb);
    await rpcClient.connect();
    clock.tick((config.params.SECONDS_PER_SLOT + 1) * 1000);
    clock.tick((config.params.SECONDS_PER_SLOT + 1) * 1000);
    expect(cb.withArgs(1).called).to.be.true;
    expect(cb.withArgs(2).called).to.be.true;
  });

  it("should not notify new epoch because has not yet come", async function () {
    const rpcClient = getRpcClient();
    const cb = sandbox.spy();
    rpcClient.onNewEpoch(cb);
    await rpcClient.connect();
    clock.tick((config.params.SLOTS_PER_EPOCH - 1) * config.params.SECONDS_PER_SLOT * 1000);
    expect(cb.notCalled).to.be.true;
  });

  it("should properly notify on new epoch", async function () {
    const rpcClient = getRpcClient();
    const cb = sandbox.spy();
    rpcClient.onNewEpoch(cb);
    await rpcClient.connect();
    clock.tick((config.params.SLOTS_PER_EPOCH + 1) * config.params.SECONDS_PER_SLOT * 1000);
    expect(cb.withArgs(1).called).to.be.true;
  });

  it("should properly notify on subsequent epoch", async function () {
    const rpcClient = getRpcClient();
    const cb = sandbox.spy();
    rpcClient.onNewEpoch(cb);
    await rpcClient.connect();
    clock.tick((config.params.SLOTS_PER_EPOCH + 1) * config.params.SECONDS_PER_SLOT * 1000);
    clock.tick((config.params.SLOTS_PER_EPOCH + 1) * config.params.SECONDS_PER_SLOT * 1000);
    expect(cb.withArgs(1).called).to.be.true;
    expect(cb.withArgs(2).called).to.be.true;
  });
});
