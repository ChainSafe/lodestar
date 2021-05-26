import {Slot} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {phase0, allForks} from "../../../../src";
import {profilerLogger} from "../../../utils/logger";
import {initBLS, generatePerfTestCachedBeaconState} from "../../util";

describe("Process Slots Performance Test", function () {
  this.timeout(0);
  const logger = profilerLogger();
  let state: allForks.CachedBeaconState<phase0.BeaconState>;

  function processEpochTest(numSlot: Slot, expectedValue: number, maxTry = 10): void {
    logger.profile(`Process ${numSlot} slots ${maxTry} times`);
    let duration = 0;
    for (let i = 0; i < maxTry; i++) {
      state = generatePerfTestCachedBeaconState({goBackOneSlot: true});
      const start = Date.now();
      allForks.processSlots(state as allForks.CachedBeaconState<allForks.BeaconState>, state.slot + numSlot);
      duration += Date.now() - start;
    }
    logger.profile(`Process ${numSlot} slots ${maxTry} times`);
    const average = duration / maxTry;
    logger.info(`Processing ${numSlot} slots in ${average}ms`);
    expect(average).lt(expectedValue, `process ${numSlot} takes longer than ${expectedValue} ms`);
  }

  const testValues = [
    {numSlot: 32, expectedValue: 1500, name: "process 1 empty epoch"},
    {numSlot: 64, expectedValue: 2750, name: "process double empty epochs"},
    {numSlot: 128, expectedValue: 4300, name: "process 4 empty epochs"},
  ];

  before(async () => {
    await initBLS();
  });

  for (const testValue of testValues) {
    it(testValue.name, async () => {
      processEpochTest(testValue.numSlot, testValue.expectedValue);
    });
  }

  // after(async () => {
  //   await new Promise((r) => setTimeout(r, 1e8));
  // });
});
