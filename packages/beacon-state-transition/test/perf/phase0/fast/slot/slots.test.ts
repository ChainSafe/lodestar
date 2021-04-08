import {Slot} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {phase0, fast} from "../../../../../src";
import {profilerLogger} from "../../../../utils/logger";
import {initBLS, generatePerfTestCachedBeaconState} from "../../../util";

describe("Process Slots Performance Test", function () {
  this.timeout(0);
  const logger = profilerLogger();
  let state: fast.CachedBeaconState<phase0.BeaconState>;

  function processEpochTest(numSlot: Slot, expectedValue: number): void {
    logger.profile(`Process ${numSlot} slots`);
    const start = Date.now();
    phase0.fast.processSlots(state, state.slot + numSlot);
    logger.profile(`Process ${numSlot} slots`);
    expect(Date.now() - start).lt(expectedValue);
  }

  const testValues = [
    {numSlot: 32, expectedValue: 570, name: "process 1 empty epoch"},
    {numSlot: 64, expectedValue: 1200, name: "process double empty epochs"},
    {numSlot: 128, expectedValue: 2000, name: "process 4 empty epochs"},
  ];

  before(async () => {
    await initBLS();
  });

  beforeEach(async () => {
    state = generatePerfTestCachedBeaconState();
  });

  for (const testValue of testValues) {
    it(testValue.name, async () => {
      processEpochTest(testValue.numSlot, testValue.expectedValue);
    });
  }
});
