import {generatePerfTestCachedBeaconState, initBLS} from "../../../util";
import {expect} from "chai";
import {phase0, fast} from "../../../../../src";
import {profilerLogger} from "../../../../utils/logger";

describe("processRewardsAndPenalties", function () {
  let state: fast.CachedBeaconState<phase0.BeaconState>;
  let epochProcess: fast.IEpochProcess;
  const logger = profilerLogger();

  before(async function () {
    this.timeout(0);
    await initBLS();
    state = generatePerfTestCachedBeaconState({goBackOneSlot: true});
  });

  it("should processRewardsAndPenalties", function () {
    this.timeout(0);
    epochProcess = fast.prepareEpochProcessState(state);
    let minTime = Number.MAX_SAFE_INTEGER;
    let maxTime = 0;
    const MAX_TRY = 10000;
    const from = process.hrtime.bigint();
    for (let i = 0; i < MAX_TRY; i++) {
      const start = Date.now();
      phase0.fast.processRewardsAndPenalties(state, epochProcess);
      const duration = Date.now() - start;
      if (duration < minTime) minTime = duration;
      if (duration > maxTime) maxTime = duration;
    }
    const to = process.hrtime.bigint();
    const average = Number((to - from) / BigInt(MAX_TRY) / BigInt(1000000));
    logger.info("processRewardsAndPenalties in ms", {minTime, maxTime, average, maxTry: MAX_TRY});
    expect(minTime).to.be.lte(67, "Minimal processRewardsAndPenalties is not less than 67ms");
    expect(maxTime).to.be.lte(700, "Maximal processRewardsAndPenalties is not less than 700ms");
    expect(average).to.be.lte(84, "Average processRewardsAndPenalties is not less than 84ms");
  });
});
