import {getEpochProposers} from "../../../../../../src/api/impl/validator";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import sinon from "sinon";
import {StateRepository} from "../../../../../../src/db/api/beacon/repositories";
import {generateState} from "../../../../../utils/state";
import {generateValidators} from "../../../../../utils/validator";
import {expect} from "chai";
import BN = require("bn.js");
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants";


describe("get proposers api impl", function () {

  const sandbox = sinon.createSandbox();

  let dbStub: any;

  beforeEach(function () {
    dbStub = {
      state: sandbox.createStubInstance(StateRepository)
    };
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should get proposers", async function () {
    dbStub.state.getLatest.resolves(
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
    const result = await getEpochProposers(config, dbStub, 1);
    expect(result.size).to.be.equal(config.params.SLOTS_PER_EPOCH);
  });

  it("should get future proposers", async function () {
    dbStub.state.getLatest.resolves(
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
    const result = await getEpochProposers(config, dbStub, 2);
    expect(result.size).to.be.equal(config.params.SLOTS_PER_EPOCH);
  });
    
});