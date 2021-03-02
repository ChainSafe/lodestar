import {config} from "@chainsafe/lodestar-config/mainnet";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import {phase0} from "../../../../../src";
import {initBLS, generatePerformanceState} from "../../../util";

describe("Process Slots Performance Test", function () {
  this.timeout(0);
  const logger = new WinstonLogger();
  let state: phase0.fast.CachedValidatorsBeaconState;
  let epochCtx: phase0.fast.EpochContext;

  before(async () => {
    await initBLS();
  });

  beforeEach(async () => {
    const origState = await generatePerformanceState();
    epochCtx = new phase0.fast.EpochContext(config);
    epochCtx.loadState(origState);
    state = phase0.fast.createCachedValidatorsBeaconState(origState);
  });

  it("process 1 empty epoch", async () => {
    const numSlot = 32;
    logger.profile(`Process ${numSlot} slots`);
    const start = Date.now();
    phase0.fast.processSlots(epochCtx, state, state.slot + numSlot);
    logger.profile(`Process ${numSlot} slots`);
    expect(Date.now() - start).lt(570);
  });

  it("process double empty epochs", async () => {
    const numSlot = 64;
    logger.profile(`Process ${numSlot} slots`);
    const start = Date.now();
    phase0.fast.processSlots(epochCtx, state, state.slot + numSlot);
    logger.profile(`Process ${numSlot} slots`);
    expect(Date.now() - start).lt(1200);
  });

  it("process 4 empty epochs", async () => {
    const numSlot = 128;
    logger.profile(`Process ${numSlot} slots`);
    const start = Date.now();
    phase0.fast.processSlots(epochCtx, state, state.slot + numSlot);
    logger.profile(`Process ${numSlot} slots`);
    expect(Date.now() - start).lt(2000);
  });
});
