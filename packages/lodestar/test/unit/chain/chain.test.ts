import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";

import {config} from "@chainsafe/lodestar-config/minimal";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";

import {BeaconChain, IBeaconChain} from "../../../src/chain";
import {defaultChainOptions} from "../../../src/chain/options";
import {BeaconMetrics} from "../../../src/metrics";
import {generateBlockSummary} from "../../utils/block";
import {generateState} from "../../utils/state";
import {StubbedBeaconDb} from "../../utils/stub";
import {generateValidators} from "../../utils/validator";
import {StateContextCache} from "../../../src/chain/stateCache";
import {testLogger} from "../../utils/logger";

describe("BeaconChain", function () {
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb, metrics: any;
  const logger = testLogger();
  let chain: IBeaconChain;

  beforeEach(() => {
    dbStub = new StubbedBeaconDb(sandbox);
    metrics = new BeaconMetrics({enabled: false} as any, {logger});
    const state = generateState();
    state.validators = generateValidators(5, {activationEpoch: 0}) as any;
    dbStub.stateArchive.lastValue.resolves(state as any);
    chain = new BeaconChain({opts: defaultChainOptions, config, db: dbStub, logger, metrics, anchorState: state});
    chain.stateCache = (sandbox.createStubInstance(StateContextCache) as unknown) as StateContextCache;
    (chain.stateCache as SinonStubbedInstance<StateContextCache> & StateContextCache).get.returns({
      state: phase0.fast.createCachedValidatorsBeaconState(state),
      epochCtx: new phase0.fast.EpochContext(config),
    });
  });

  afterEach(() => {
    chain.close();
    sandbox.restore();
  });

  describe("getENRForkID", () => {
    it("should get enr fork id if not found next fork", () => {
      chain.forkChoice.getHead = () => generateBlockSummary();
      const enrForkID = chain.getENRForkID();
      expect(config.types.Version.equals(enrForkID.nextForkVersion, Buffer.from([255, 255, 255, 255])));
      expect(enrForkID.nextForkEpoch === Number.MAX_SAFE_INTEGER);
      // it's possible to serialize enr fork id
      config.types.phase0.ENRForkID.hashTreeRoot(enrForkID);
    });
  });
});
