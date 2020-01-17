import {getEpochProposers} from "../../../../../../src/api/impl/validator";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import sinon from "sinon";
import {BlockRepository, StateRepository} from "../../../../../../src/db/api/beacon/repositories";
import {generateState} from "../../../../../utils/state";
import {generateValidators} from "../../../../../utils/validator";
import {expect} from "chai";
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants";
import {BeaconChain, StatefulDagLMDGHOST} from "../../../../../../src/chain";


describe("get proposers api impl", function () {

  const sandbox = sinon.createSandbox();

  let dbStub: any, chainStub: any;

  beforeEach(function () {
    dbStub = {
      state: sandbox.createStubInstance(StateRepository),
      block: sandbox.createStubInstance(BlockRepository),
    };
    chainStub = sandbox.createStubInstance(BeaconChain);
    chainStub.forkChoice = sandbox.createStubInstance(StatefulDagLMDGHOST);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should get proposers", async function () {
    dbStub.block.get.resolves({stateRoot: Buffer.alloc(32)});
    dbStub.state.get.resolves(
      generateState(
        {
          slot: 0,
          validators: generateValidators(
            25,
            {balance: config.params.MAX_EFFECTIVE_BALANCE, activation: 0, exit: FAR_FUTURE_EPOCH}
          ),
          balances: Array.from({length: 25}, () => config.params.MAX_EFFECTIVE_BALANCE)
        }, config),

    );
    const result = await getEpochProposers(config, chainStub, dbStub, 1);
    expect(result.size).to.be.equal(config.params.SLOTS_PER_EPOCH);
  });

  it("should get future proposers", async function () {
    dbStub.block.get.resolves({stateRoot: Buffer.alloc(32)});
    dbStub.state.get.resolves(
      generateState(
        {
          slot: config.params.SLOTS_PER_EPOCH - 3,
          validators: generateValidators(
            25,
            {balance: config.params.MAX_EFFECTIVE_BALANCE, activation: 0, exit: FAR_FUTURE_EPOCH}
          ),
          balances: Array.from({length: 25}, () => config.params.MAX_EFFECTIVE_BALANCE)
        }, config),

    );
    const result = await getEpochProposers(config, chainStub, dbStub, 2);
    expect(result.size).to.be.equal(config.params.SLOTS_PER_EPOCH);
  });
    
});