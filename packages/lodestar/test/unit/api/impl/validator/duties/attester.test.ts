import {SinonStubbedInstance} from "sinon";
import {config} from "@chainsafe/lodestar-config/default";
import {createCachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

import {ForkChoice, IBeaconChain} from "../../../../../../src/chain";
import {LocalClock} from "../../../../../../src/chain/clock";
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants";
import {IEth1ForBlockProduction} from "../../../../../../src/eth1";
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
import {MAX_EFFECTIVE_BALANCE} from "@chainsafe/lodestar-params";

describe("get attesters api impl", function () {
  this.timeout(0);
  const logger = testLogger();
  let eth1Stub: SinonStubbedInstance<IEth1ForBlockProduction>;

  let chainStub: SinonStubbedInstance<IBeaconChain>,
    syncStub: SinonStubbedInstance<IBeaconSync>,
    dbStub: StubbedBeaconDb;

  let api: ReturnType<typeof getValidatorApi>;
  let server: ApiImplTestModules;
  let modules: ApiModules;

  let indices: number[];
  let totalPerf = 0;
  const numRuns = 50;

  before(function () {
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
      eth1: eth1Stub,
      logger,
      network: server.networkStub,
      sync: syncStub,
      metrics: null,
    };
    api = getValidatorApi(modules);

    const numValidators = 20000;

    const validators = generateValidators(numValidators, {
      effectiveBalance: MAX_EFFECTIVE_BALANCE,
      activationEpoch: 0,
      exitEpoch: FAR_FUTURE_EPOCH,
    });
    syncStub.isSynced.returns(true);
    server.sandbox.stub(chainStub.clock, "currentEpoch").get(() => 0);
    server.sandbox.stub(chainStub.clock, "currentSlot").get(() => 0);
    dbStub.block.get.resolves({message: {stateRoot: Buffer.alloc(32)}} as any);
    const state = generateState(
      {
        slot: 0,
        validators,
        balances: generateInitialMaxBalances(config, numValidators),
      },
      config
    );
    const cachedState = createCachedBeaconState(config, state);
    chainStub.getHeadStateAtCurrentEpoch.resolves(cachedState);

    indices = Array.from({length: numValidators}, (_, i) => i);
  });

  after(() => {
    console.log("number of runs: ", numRuns);
    console.log("performance avg: ", totalPerf / numRuns);
  });

  for (let i = 0; i < numRuns; i++) {
    it("getAttesterDuties perf test", async () => {
      const start = Date.now();
      await api.getAttesterDuties(0, indices);
      const perf = Date.now() - start;
      totalPerf += perf;
    });
  }
});
