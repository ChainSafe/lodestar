import sinon from "sinon";
import {expect} from "chai";

import {config} from "../../../../../src/config/presets/mainnet";
import {BeaconApi} from "../../../../../src/rpc/api/beacon";
import {BeaconDB} from "../../../../../src/db/api";
import {BeaconChain} from "../../../../../src/chain";

import {generateState} from "../../../../utils/state";
import {generateEmptyBlock} from "../../../../utils/block";

describe('beacon rpc api', function () {

  const sandbox = sinon.createSandbox();

  let beaconApi: BeaconApi, chainStub, dbStub;

  beforeEach(() => {
    dbStub = sandbox.createStubInstance(BeaconDB);
    chainStub = sandbox.createStubInstance(BeaconChain);
    beaconApi = new BeaconApi({}, {
      config,
      chain: chainStub,
      db: dbStub
    });
  });

  it('should return client version', async function() {
    const version = await beaconApi.getClientVersion();
    expect(version).to.not.be.null;
  });

  it('should return fork from state', async function() {
    const state = generateState({
      fork: {
        epoch: 2,
        previousVersion: Buffer.from("1"),
        currentVersion: Buffer.from("2")
      }
    });
    dbStub.getLatestState.resolves(state);
    const fork = await beaconApi.getFork();
    expect(dbStub.getLatestState.calledOnce).to.be.true;
    expect(fork).to.be.deep.equal(state.fork);
  });

  it('should return genesis time', async function() {
    chainStub.genesisTime = Date.now();
    const genesisTime = await beaconApi.getGenesisTime();
    expect(genesisTime).to.be.equal(chainStub.genesisTime);
  });

  it('should return syncing status', async function() {
    const status = await beaconApi.getSyncingStatus();
    expect(status).to.be.false;
  });

  it('should return state', async function() {
    const state = generateState();
    dbStub.getLatestState.resolves(state);
    const result = await beaconApi.getBeaconState();
    expect(dbStub.getLatestState.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(state);
  });

  it('should return chain head', async function() {
    const block = generateEmptyBlock();
    dbStub.getChainHead.resolves(block);
    const result = await beaconApi.getChainHead();
    expect(dbStub.getChainHead.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(block);
  });

});

