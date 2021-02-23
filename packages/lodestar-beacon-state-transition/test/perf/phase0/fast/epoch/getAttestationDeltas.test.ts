import {config} from "@chainsafe/lodestar-config/mainnet";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {generatePerformanceState, initBLS} from "../../../util";
import {expect} from "chai";
import {phase0} from "../../../../../src";

describe("getAttestationDeltas", function () {
  let state: phase0.fast.CachedValidatorsBeaconState;
  let epochCtx: phase0.EpochContext;
  let epochProcess: phase0.fast.IEpochProcess;
  const logger = new WinstonLogger();

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
    expect(minTime).to.be.lt(67, "Minimal balances assignment is not less than 67ms");
    expect(maxTime).to.be.lt(620, "Maximal balances assignment is not less than 620ms");
    expect(average).to.be.lt(75, "Average balances assignment is not less than 75ms");
  });
});
