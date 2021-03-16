import {config} from "@chainsafe/lodestar-config/mainnet";
import {generatePerformanceState, initBLS} from "../../../util";
import {expect} from "chai";
import {phase0} from "../../../../../src";
import {profilerLogger} from "../../../../utils/logger";

describe("getAttestationDeltas", function () {
  let state: phase0.fast.CachedBeaconState<phase0.BeaconState>;
  let epochProcess: phase0.fast.IEpochProcess;
  const logger = profilerLogger();

  before(async function () {
    this.timeout(0);
    await initBLS();
    const origState = await generatePerformanceState();
    // go back 1 slot to process epoch
    origState.slot -= 1;
    state = phase0.fast.createCachedBeaconState(config, origState);
  });

  it("should getAttestationDeltas", function () {
    this.timeout(0);
    epochProcess = phase0.fast.prepareEpochProcessState(state);
    let minTime = Number.MAX_SAFE_INTEGER;
    let maxTime = 0;
    const MAX_TRY = 10000;
    const from = process.hrtime.bigint();
    for (let i = 0; i < MAX_TRY; i++) {
      const start = Date.now();
      phase0.fast.getAttestationDeltas(state, epochProcess);
      const duration = Date.now() - start;
      if (duration < minTime) minTime = duration;
      if (duration > maxTime) maxTime = duration;
    }
    const to = process.hrtime.bigint();
    const average = Number((to - from) / BigInt(MAX_TRY) / BigInt(1000000));
    logger.info("getAttestationDeltas in ms", {minTime, maxTime, average, maxTry: MAX_TRY});
    expect(minTime).to.be.lte(64, "Minimal getAttestationDeltas is not less than 67ms");
    expect(maxTime).to.be.lte(500, "Maximal getAttestationDeltas is not less than 500ms");
    expect(average).to.be.lte(79, "Average getAttestationDeltas is not less than 75ms");
  });
});
