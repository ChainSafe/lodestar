import {config} from "@chainsafe/lodestar-config/mainnet";
import {profilerLogger} from "../../../../utils/logger";
import {generatePerformanceState, initBLS} from "../../../util";
import {expect} from "chai";
import {phase0, fast} from "../../../../../src";

describe("Epoch Processing Performance Tests", function () {
  let state: fast.CachedBeaconState<phase0.BeaconState>;
  let process: fast.IEpochProcess;
  const logger = profilerLogger();
  let start: number;

  before(async function () {
    this.timeout(0);
    await initBLS();
    const origState = generatePerformanceState();
    // go back 1 slot to process epoch
    origState.slot -= 1;
    state = fast.createCachedBeaconState(config, origState);
    process = fast.prepareEpochProcessState(state);
  });

  beforeEach(function () {
    start = Date.now();
  });

  const testValues = [
    {
      // not stable, sometimes < 1400, sometimes > 2000
      expected: 100,
    },
    {
      testFunc: phase0.fast.processJustificationAndFinalization,
      expected: 2,
    },
    {
      testFunc: phase0.fast.processRewardsAndPenalties,
      expected: 250,
    },
    {
      testFunc: phase0.fast.processRegistryUpdates,
      expected: 2,
    },
    {
      testFunc: phase0.fast.processSlashings,
      expected: 25,
    },
    {
      testFunc: phase0.fast.processFinalUpdates,
      expected: 30,
    },
  ];

  for (const testValue of testValues) {
    const name = testValue.testFunc ? testValue.testFunc.name : "prepareEpochProcessState";
    it(name, async () => {
      logger.profile(name);
      testValue.testFunc && testValue.testFunc(state, process);
      logger.profile(name);
      expect(Date.now() - start).lt(testValue.expected);
    });
  }
});
