import {expect} from "chai";
import sinon from "sinon";

import {BeaconState} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/minimal";
import {bytesToInt, WinstonLogger} from "@chainsafe/lodestar-utils";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";

import {BeaconChain, IBeaconChain} from "../../../src/chain";
import {defaultChainOptions} from "../../../src/chain/options";
import {BeaconMetrics} from "../../../src/metrics";
import {generateBlockSummary} from "../../utils/block";
import {generateState} from "../../utils/state";
import {StubbedBeaconDb} from "../../utils/stub";
import {generateValidators} from "../../utils/validator";
import {createCachedValidatorsBeaconState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";

describe("BeaconChain", function () {
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb, metrics: any;
  const logger = new WinstonLogger();
  let chain: IBeaconChain;

  beforeEach(async () => {
    dbStub = new StubbedBeaconDb(sandbox);
    metrics = new BeaconMetrics({enabled: false} as any, {logger});
    const state: BeaconState = generateState();
    state.validators = generateValidators(5, {activationEpoch: 0});
    dbStub.stateCache.get.resolves({
      state: createCachedValidatorsBeaconState(state),
      epochCtx: new EpochContext(config),
    });
    dbStub.stateArchive.lastValue.resolves(state as any);
    chain = new BeaconChain({opts: defaultChainOptions, config, db: dbStub, logger, metrics, anchorState: state});
  });

  afterEach(async () => {
    await chain.close();
    sandbox.restore();
  });

  describe("getENRForkID", () => {
    it("should get enr fork id if not found next fork", async () => {
      chain.forkChoice.getHead = () => generateBlockSummary();
      const enrForkID = await chain.getENRForkID();
      expect(config.types.Version.equals(enrForkID.nextForkVersion, Buffer.from([255, 255, 255, 255])));
      expect(enrForkID.nextForkEpoch === Number.MAX_SAFE_INTEGER);
      // it's possible to serialize enr fork id
      config.types.ENRForkID.hashTreeRoot(enrForkID);
    });

    it("should get enr fork id if found next fork", async () => {
      config.params.ALL_FORKS = [
        {
          currentVersion: 2,
          epoch: 100,
          previousVersion: bytesToInt(config.params.GENESIS_FORK_VERSION),
        },
      ];
      chain.forkChoice.getHead = () => generateBlockSummary();
      const enrForkID = await chain.getENRForkID();
      expect(config.types.Version.equals(enrForkID.nextForkVersion, Buffer.from([2, 0, 0, 0])));
      expect(enrForkID.nextForkEpoch === 100);
      // it's possible to serialize enr fork id
      config.types.ENRForkID.hashTreeRoot(enrForkID);
      config.params.ALL_FORKS = undefined!;
    });
  });
});
