import sinon from "sinon";
import {expect} from "chai";
import {RpcClientOverInstance} from "../../../../src/validator/rpc";
import {MockBeaconApi} from "../../../utils/mocks/rpc/beacon";
import {createIBeaconConfig} from "../../../../src/config";
import * as mainnetParams from "../../../../src/params/presets/mainnet";

describe('RpcClientOverInstance test', function() {

  let clock, sandbox;
  let config = createIBeaconConfig(mainnetParams);

  before(() => {
    sandbox = sinon.createSandbox();
  });

  after(() => {
    sandbox.restore();
  });

  beforeEach(() => {
    clock = sandbox.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
  });

  it('should not notify new slot because has not yet come', async function() {
    const rpcClient = new RpcClientOverInstance({
      config,
      beacon: new MockBeaconApi({
        genesisTime: Date.now() / 1000
      }),
      validator: null
    });
    const cb = sandbox.spy();
    await rpcClient.connect();
    rpcClient.onNewSlot(cb);
    clock.tick((config.params.SECONDS_PER_SLOT - 1) * 1000);
    expect(cb.notCalled).to.be.true;
  });

  it('should properly notify on new slot', async function() {
    const rpcClient = new RpcClientOverInstance({
      config,
      beacon: new MockBeaconApi({
        genesisTime: Date.now() / 1000
      }),
      validator: null
    });
    const cb = sandbox.spy();
    rpcClient.onNewSlot(cb);
    await rpcClient.connect();
    clock.tick((config.params.SECONDS_PER_SLOT + 1) * 1000);
    expect(cb.withArgs(1).called).to.be.true;
  });

  it('should properly notify on next slot', async function() {
    const rpcClient = new RpcClientOverInstance({
      config,
      beacon: new MockBeaconApi({
        genesisTime: Date.now() / 1000
      }),
      validator: null
    });
    const cb = sandbox.spy();
    rpcClient.onNewSlot(cb);
    await rpcClient.connect();
    clock.tick((config.params.SECONDS_PER_SLOT + 1) * 1000);
    clock.tick((config.params.SECONDS_PER_SLOT + 1) * 1000);
    expect(cb.withArgs(1).called).to.be.true;
    expect(cb.withArgs(2).called).to.be.true;
  });

  it('should not notify new epoch because has not yet come', async function() {
    const rpcClient = new RpcClientOverInstance({
      config,
      beacon: new MockBeaconApi({
        genesisTime: Date.now() / 1000
      }),
      validator: null
    });
    const cb = sandbox.spy();
    rpcClient.onNewEpoch(cb);
    await rpcClient.connect();
    clock.tick((config.params.SLOTS_PER_EPOCH - 1) * config.params.SECONDS_PER_SLOT * 1000);
    expect(cb.notCalled).to.be.true;
  });

  it('should properly notify on new epoch', async function() {
    const rpcClient = new RpcClientOverInstance({
      config,
      beacon: new MockBeaconApi({
        genesisTime: Date.now() / 1000
      }),
      validator: null
    });
    const cb = sandbox.spy();
    rpcClient.onNewEpoch(cb);
    await rpcClient.connect();
    clock.tick((config.params.SLOTS_PER_EPOCH + 1) * config.params.SECONDS_PER_SLOT * 1000);
    expect(cb.withArgs(1).called).to.be.true;
  });

  it('should properly notify on subsequent epoch', async function() {
    const rpcClient = new RpcClientOverInstance({
      config,
      beacon: new MockBeaconApi({
        genesisTime: Date.now() / 1000
      }),
      validator: null
    });
    const cb = sandbox.spy();
    rpcClient.onNewEpoch(cb);
    await rpcClient.connect();
    clock.tick((config.params.SLOTS_PER_EPOCH + 1) * config.params.SECONDS_PER_SLOT * 1000);
    clock.tick((config.params.SLOTS_PER_EPOCH + 1) * config.params.SECONDS_PER_SLOT * 1000);
    expect(cb.withArgs(1).called).to.be.true;
    expect(cb.withArgs(2).called).to.be.true;
  });

});

