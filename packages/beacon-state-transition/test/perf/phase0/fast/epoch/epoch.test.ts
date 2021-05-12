import {profilerLogger} from "../../../../utils/logger";
import {generatePerfTestCachedBeaconState, initBLS} from "../../../util";
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
    state = generatePerfTestCachedBeaconState({goBackOneSlot: true});
    process = fast.prepareEpochProcessState(state);
  });

  beforeEach(function () {
    start = Date.now();
  });

  const testValues: {
    testFunc?: (state: fast.CachedBeaconState<phase0.BeaconState>, process: fast.IEpochProcess) => void;
    expected: number;
  }[] = [
    {
      // not stable, sometimes < 1400, sometimes > 2000
      expected: 100,
    },
    {
      testFunc: phase0.fast.processJustificationAndFinalization as (
        state: fast.CachedBeaconState<phase0.BeaconState>,
        process: fast.IEpochProcess
      ) => void,
      expected: 2,
    },
    {
      testFunc: phase0.fast.processRewardsAndPenalties,
      expected: 240,
    },
    {
      testFunc: phase0.fast.processRegistryUpdates as (
        state: fast.CachedBeaconState<phase0.BeaconState>,
        process: fast.IEpochProcess
      ) => void,
      expected: 2,
    },
    {
      testFunc: phase0.fast.processSlashings,
      expected: 8,
    },
    {
      testFunc: phase0.fast.processFinalUpdates,
      expected: 36,
    },
  ];

  for (const testValue of testValues) {
    const name = testValue.testFunc ? testValue.testFunc.name : "prepareEpochProcessState";
    it(name, async () => {
      logger.profile(name);
      testValue.testFunc && testValue.testFunc(state, process);
      logger.profile(name);
      expect(Date.now() - start).lte(testValue.expected);
    });
  }
});
