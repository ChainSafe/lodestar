import sinon, {SinonStubbedInstance} from "sinon";
import {use, expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {config} from "@chainsafe/lodestar-config/default";
import {createCachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {IBeaconChain} from "../../../../../../src/chain";
import {LocalClock} from "../../../../../../src/chain/clock";
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants";
import {getValidatorApi} from "../../../../../../src/api/impl/validator";
import {ApiModules} from "../../../../../../src/api/impl/types";
import {generateInitialMaxBalances} from "../../../../../utils/balances";
import {generateState} from "../../../../../utils/state";
import {IBeaconSync} from "../../../../../../src/sync";
import {generateValidators} from "../../../../../utils/validator";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test";
import {testLogger} from "../../../../../utils/logger";
import {ssz} from "@chainsafe/lodestar-types";
import {MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";

use(chaiAsPromised);

describe("get proposers api impl", function () {
  const logger = testLogger();

  let chainStub: SinonStubbedInstance<IBeaconChain>,
    syncStub: SinonStubbedInstance<IBeaconSync>,
    dbStub: StubbedBeaconDb;

  let api: ReturnType<typeof getValidatorApi>;
  let server: ApiImplTestModules;
  let modules: ApiModules;

  beforeEach(function () {
    server = setupApiImplTestServer();
    chainStub = server.chainStub;
    syncStub = server.syncStub;
    chainStub.clock = server.sandbox.createStubInstance(LocalClock);
    chainStub.forkChoice = server.sandbox.createStubInstance(ForkChoice);
    chainStub.getCanonicalBlockAtSlot.resolves(ssz.phase0.SignedBeaconBlock.defaultValue());
    dbStub = server.dbStub;
    modules = {
      chain: server.chainStub,
      config,
      db: server.dbStub,
      logger,
      network: server.networkStub,
      sync: syncStub,
      metrics: null,
    };
    api = getValidatorApi(modules);
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
          effectiveBalance: MAX_EFFECTIVE_BALANCE,
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
    const {data: result} = await api.getProposerDuties(0);
    expect(result.length).to.be.equal(SLOTS_PER_EPOCH);
  });
});
