import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import {BlockRepository} from "../../../../../../src/db/api/beacon/repositories";
import {generateState} from "../../../../../utils/state";
import {generateValidators} from "../../../../../utils/validator";
import {expect} from "chai";
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants";
import {BeaconChain, IBeaconChain} from "../../../../../../src/chain";
import {IValidatorApi, ValidatorApi} from "../../../../../../src/api/impl/validator";
import {StubbedBeaconDb} from "../../../../../utils/stub";


describe("get proposers api impl", function () {

  const sandbox = sinon.createSandbox();

  let dbStub: StubbedBeaconDb, chainStub: SinonStubbedInstance<IBeaconChain>;
  
  let api: IValidatorApi;

  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sandbox, config);
    chainStub = sandbox.createStubInstance(BeaconChain);
    // @ts-ignore
    api = new ValidatorApi({}, {db: dbStub, chain: chainStub, config});
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should get proposers", async function () {
    dbStub.block.get.resolves({message: {stateRoot: Buffer.alloc(32)}} as any);
    chainStub.getHeadState.resolves(
      generateState(
        {
          slot: 0,
          validators: generateValidators(
            25,
            {effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE, activationEpoch: 0, exitEpoch: FAR_FUTURE_EPOCH}
          ),
          balances: Array.from({length: 25}, () => config.params.MAX_EFFECTIVE_BALANCE)
        }, config),

    );
    const result = await api.getProposerDuties(1);
    expect(result.length).to.be.equal(config.params.SLOTS_PER_EPOCH);
  });

  it("should get future proposers", async function () {
    chainStub.getHeadState.resolves(
      generateState(
        {
          slot: config.params.SLOTS_PER_EPOCH - 3,
          validators: generateValidators(
            25,
            {effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE, activationEpoch: 0, exitEpoch: FAR_FUTURE_EPOCH}
          ),
          balances: Array.from({length: 25}, () => config.params.MAX_EFFECTIVE_BALANCE)
        }, config),

    );
    const result = await api.getProposerDuties(2);
    expect(result.length).to.be.equal(config.params.SLOTS_PER_EPOCH);
  });
});
