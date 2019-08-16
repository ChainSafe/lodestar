import sinon from "sinon";
import {expect} from "chai";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {BeaconApi} from "../../../../../../src/api/rpc/api/beacon";
import {BeaconChain} from "../../../../../../src/chain";

import {generateState} from "../../../../../utils/state";
import {generateEmptyBlock} from "../../../../../utils/block";
import {BlockRepository, StateRepository} from "../../../../../../src/db/api/beacon/repositories";
import {describe} from "mocha";

describe('beacon rpc api', function () {

  const sandbox = sinon.createSandbox();

  let beaconApi: BeaconApi, chainStub, dbStub;

  beforeEach(() => {
    dbStub = {
      state: sandbox.createStubInstance(StateRepository),
      block: sandbox.createStubInstance(BlockRepository)
    };
    chainStub = sandbox.createStubInstance(BeaconChain);
    // @ts-ignore
    beaconApi = new BeaconApi({}, {
      config,
      chain: chainStub,
      db: dbStub
    });
  });

  it('should return client version', async function () {
    const version = await beaconApi.getClientVersion();
    expect(version).to.not.be.null;
  });

  it('should return fork from state', async function () {
    const state = generateState({
      fork: {
        epoch: 2,
        previousVersion: Buffer.from("1"),
        currentVersion: Buffer.from("2")
      }
    });
    dbStub.state.getLatest.resolves(state);
    const fork = await beaconApi.getFork();
    expect(dbStub.state.getLatest.calledOnce).to.be.true;
    expect(fork).to.be.deep.equal(state.fork);
  });

  it('should return genesis time', async function () {
    chainStub.latestState = generateState({genesisTime: Date.now()});
    const genesisTime = await beaconApi.getGenesisTime();
    expect(genesisTime).to.be.equal(chainStub.latestState.genesisTime);
  });

  it('should return syncing status', async function () {
    const status = await beaconApi.getSyncingStatus();
    expect(status).to.be.false;
  });

  it('should return state', async function () {
    const state = generateState();
    dbStub.state.getLatest.resolves(state);
    const result = await beaconApi.getBeaconState();
    expect(dbStub.state.getLatest.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(state);
  });

  it('should return chain head', async function () {
    const block = generateEmptyBlock();
    dbStub.block.getChainHead.resolves(block);
    const result = await beaconApi.getChainHead();
    expect(dbStub.block.getChainHead.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(block);
  });

});

