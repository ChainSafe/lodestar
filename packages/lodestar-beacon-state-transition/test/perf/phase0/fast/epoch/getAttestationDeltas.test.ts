import {config} from "@chainsafe/lodestar-config/mainnet";
import {Logger} from "@chainsafe/lodestar-utils";
import {generatePerformanceState, initBLS} from "../../../util";
import {expect} from "chai";
import {phase0} from "../../../../../src";

describe("getAttestationDeltas", function () {
  let state: phase0.fast.CachedValidatorsBeaconState;
  let epochCtx: phase0.EpochContext;
  let epochProcess: phase0.fast.IEpochProcess;
  const logger = new Logger();

  before(async function () {
    this.timeout(0);
    await initBLS();
    const origState = await generatePerformanceState();
    // go back 1 slot to process epoch
    origState.slot -= 1;
    epochCtx = new phase0.EpochContext(config);
    epochCtx.loadState(origState);
    state = phase0.fast.createCachedValidatorsBeaconState(origState);
  });

  it("should getAttestationDeltas", function () {
    this.timeout(0);
    epochProcess = phase0.fast.prepareEpochProcessState(epochCtx, state);
    let minTime = Number.MAX_SAFE_INTEGER;
    let maxTime = 0;
    const MAX_TRY = 10000;
    const from = process.hrtime.bigint();
    for (let i = 0; i < MAX_TRY; i++) {
      const start = Date.now();
      phase0.fast.getAttestationDeltas(epochCtx, epochProcess, state);
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
