import {config} from "@chainsafe/lodestar-config/mainnet";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {
  CachedValidatorsBeaconState,
  createCachedValidatorsBeaconState,
  IEpochProcess,
  prepareEpochProcessState,
} from "../../src/fast/util";
import {EpochContext} from "../../src/fast/util/epochContext";
import {
  processFinalUpdates,
  processJustificationAndFinalization,
  processRegistryUpdates,
  processRewardsAndPenalties,
  processSlashings,
  processForkChanged,
} from "../../src/fast/epoch";
import {generatePerformanceState, initBLS} from "./util";
import {expect} from "chai";

describe("Epoch Processing Performance Tests", function () {
  let state: CachedValidatorsBeaconState;
  let epochCtx: EpochContext;
  let process: IEpochProcess;
  const logger = new WinstonLogger();

  before(async function () {
    this.timeout(0);
    await initBLS();
    const origState = await generatePerformanceState();
    // go back 1 slot to process epoch
    origState.slot -= 1;
    epochCtx = new EpochContext(config);
    epochCtx.loadState(origState);
    state = createCachedValidatorsBeaconState(origState);
  });

  it("prepareEpochProcessState", async () => {
    const start = Date.now();
    logger.profile("prepareEpochProcessState");
    process = prepareEpochProcessState(epochCtx, state);
    logger.profile("prepareEpochProcessState");
    // not stable, sometimes < 1400, sometimes > 2000
    expect(Date.now() - start).lt(100);
  });

  it("processJustificationAndFinalization", async () => {
    const start = Date.now();
    logger.profile("processJustificationAndFinalization");
    processJustificationAndFinalization(epochCtx, process, state);
    logger.profile("processJustificationAndFinalization");
    expect(Date.now() - start).lte(2);
  });

  it("processRewardsAndPenalties", async () => {
    const start = Date.now();
    logger.profile("processRewardsAndPenalties");
    processRewardsAndPenalties(epochCtx, process, state);
    logger.profile("processRewardsAndPenalties");
    expect(Date.now() - start).lt(700);
  });

  it("processRegistryUpdates", async () => {
    const start = Date.now();
    logger.profile("processRegistryUpdates");
    processRegistryUpdates(epochCtx, process, state);
    logger.profile("processRegistryUpdates");
    expect(Date.now() - start).lte(2);
  });

  it("processSlashings", async () => {
    const start = Date.now();
    logger.profile("processSlashings");
    processSlashings(epochCtx, process, state);
    logger.profile("processSlashings");
    expect(Date.now() - start).lte(25);
  });

  it("processFinalUpdates", async () => {
    const start = Date.now();
    logger.profile("processFinalUpdates");
    processFinalUpdates(epochCtx, process, state);
    logger.profile("processFinalUpdates");
    expect(Date.now() - start).lte(30);
  });

  it("processForkChanged", async () => {
    const start = Date.now();
    logger.profile("processForkChanged");
    processForkChanged(epochCtx, process, state);
    logger.profile("processForkChanged");
    expect(Date.now() - start).lte(2);
  });
});
