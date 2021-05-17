import {profilerLogger} from "../../../utils/logger";
import {generatePerfTestCachedBeaconState, initBLS} from "../../util";
import {expect} from "chai";
import {phase0, allForks} from "../../../../src";

describe("Epoch Processing Performance Tests", function () {
  let state: allForks.CachedBeaconState<phase0.BeaconState>;
  let process: allForks.IEpochProcess;
  const logger = profilerLogger();
  let start: number;

  before(async function () {
    this.timeout(0);
    await initBLS();
    state = generatePerfTestCachedBeaconState({goBackOneSlot: true});
    process = allForks.prepareEpochProcessState(state);
  });

  beforeEach(function () {
    start = Date.now();
  });

  const testValues: {
    testFunc?: (state: allForks.CachedBeaconState<phase0.BeaconState>, process: allForks.IEpochProcess) => void;
    expected: number;
  }[] = [
    {
      // not stable, sometimes < 1400, sometimes > 2000
      expected: 100,
    },
    {
      testFunc: phase0.processJustificationAndFinalization as (
        state: allForks.CachedBeaconState<phase0.BeaconState>,
        process: allForks.IEpochProcess
      ) => void,
      expected: 2,
    },
    {
      testFunc: phase0.processRewardsAndPenalties,
      expected: 240,
    },
    {
      testFunc: phase0.processRegistryUpdates as (
        state: allForks.CachedBeaconState<phase0.BeaconState>,
        process: allForks.IEpochProcess
      ) => void,
      expected: 2,
    },
    {
      testFunc: phase0.processSlashings,
      expected: 8,
    },
    {
      testFunc: phase0.processFinalUpdates,
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
