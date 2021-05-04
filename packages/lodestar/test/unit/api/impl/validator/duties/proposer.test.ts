import sinon, {SinonStubbedInstance} from "sinon";
import {use, expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {config} from "@chainsafe/lodestar-config/minimal";
import {createCachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

import {ForkChoice, IBeaconChain} from "../../../../../../src/chain";
import {LocalClock} from "../../../../../../src/chain/clock";
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants";
import {IEth1ForBlockProduction} from "../../../../../../src/eth1";
import {IValidatorApi, ValidatorApi} from "../../../../../../src/api/impl/validator";
import {IApiModules} from "../../../../../../src/api/impl/interface";
import {generateInitialMaxBalances} from "../../../../../utils/balances";
import {generateState} from "../../../../../utils/state";
import {IBeaconSync} from "../../../../../../src/sync";
import {generateValidators} from "../../../../../utils/validator";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test";
import {testLogger} from "../../../../../utils/logger";

use(chaiAsPromised);

describe("get proposers api impl", function () {
  const logger = testLogger();
  let eth1Stub: SinonStubbedInstance<IEth1ForBlockProduction>;

  let chainStub: SinonStubbedInstance<IBeaconChain>,
    syncStub: SinonStubbedInstance<IBeaconSync>,
    dbStub: StubbedBeaconDb;

  let api: IValidatorApi;
  let server: ApiImplTestModules;
  let modules: IApiModules;

  beforeEach(function () {
    server = setupApiImplTestServer();
    chainStub = server.chainStub;
    syncStub = server.syncStub;
    chainStub.clock = server.sandbox.createStubInstance(LocalClock);
    chainStub.forkChoice = server.sandbox.createStubInstance(ForkChoice);
    chainStub.getCanonicalBlockAtSlot.resolves(config.types.phase0.SignedBeaconBlock.defaultValue());
    dbStub = server.dbStub;
    modules = {
      chain: server.chainStub,
      config,
      db: server.dbStub,
      eth1: eth1Stub,
      logger,
      network: server.networkStub,
      sync: syncStub,
      metrics: null,
    };
    api = new ValidatorApi({}, modules);
  });

  it("should get proposers", async function () {
    syncStub.isSynced.returns(true);
    server.sandbox.stub(chainStub.clock, "currentEpoch").get(() => 0);
    server.sandbox.stub(chainStub.clock, "currentSlot").get(() => 0);
    dbStub.block.get.resolves({message: {stateRoot: Buffer.alloc(32)}} as any);
    const state = generateState(
      {
        slot: 0,
        validators: generateValidators(25, {
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE,
          activationEpoch: 0,
          exitEpoch: FAR_FUTURE_EPOCH,
        }),
        balances: generateInitialMaxBalances(config, 25),
      },
      config
    );
    const cachedState = createCachedBeaconState(config, state);
    chainStub.getHeadStateAtCurrentEpoch.resolves(cachedState);
    sinon.stub(cachedState.epochCtx, "getBeaconProposer").returns(1);
    const result = await api.getProposerDuties(0);
    expect(result.data.length).to.be.equal(config.params.SLOTS_PER_EPOCH);
  });
});
