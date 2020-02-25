import sinon, { SinonStubbedInstance } from "sinon";
import {expect} from "chai";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {BeaconApi} from "../../../../../../src/api/rpc/api/beacon";
import {BeaconChain} from "../../../../../../src/chain";

import {generateState} from "../../../../../utils/state";
import {BlockRepository, StateRepository} from "../../../../../../src/db/api/beacon/repositories";
import {describe} from "mocha";
import {IBeaconDb} from "../../../../../db";

describe("beacon rpc api", function () {

  const sandbox = sinon.createSandbox();

  let beaconApi: BeaconApi;
  let dbStub: {
    state: SinonStubbedInstance<StateRepository>;
    block: SinonStubbedInstance<BlockRepository>;
  };
  let chainStub: SinonStubbedInstance<BeaconChain>;

  beforeEach(() => {
    dbStub = {
      state: sandbox.createStubInstance(StateRepository),
      block: sandbox.createStubInstance(BlockRepository)
    };
    chainStub = sandbox.createStubInstance(BeaconChain);
    // @ts-ignore
    chainStub.config = config;
    // @ts-ignore
    beaconApi = new BeaconApi({}, {
      config,
      chain: chainStub,
      db: dbStub as unknown as IBeaconDb
    });
  });

  it("should return client version", async function () {
    const version = await beaconApi.getClientVersion();
    expect(version).to.not.be.null;
  });

  it("should return fork from state", async function () {
    const state = generateState({
      fork: {
        epoch: 2,
        previousVersion: Buffer.from("1"),
        currentVersion: Buffer.from("2")
      }
    });
    dbStub.state.getLatest.resolves(state);
    const {fork} = await beaconApi.getFork();
    expect(dbStub.state.getLatest.calledOnce).to.be.true;
    expect(fork).to.be.deep.equal(state.fork);
  });

  it("should be able to get fork when chain didnt start", async function () {
    // When chain didn"t start, latest state is null
    dbStub.state.getLatest.resolves(null);
    const {fork} = await beaconApi.getFork();
    expect(fork.previousVersion).to.be.deep.equal(Buffer.alloc(4));
    expect(fork.currentVersion).to.be.deep.equal(Buffer.alloc(4));
    expect(fork.epoch).to.be.equal(0);
  });

  it("should return genesis time", async function () {
    chainStub.latestState = generateState({genesisTime: Date.now()});
    const genesisTime = await beaconApi.getGenesisTime();
    expect(genesisTime).to.be.equal(chainStub.latestState.genesisTime);
  });

  it("should return syncing status", async function () {
    const status = await beaconApi.getSyncingStatus();
    expect(status).to.be.false;
  });
});

