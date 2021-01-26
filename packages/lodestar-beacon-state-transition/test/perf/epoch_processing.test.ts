import {config} from "@chainsafe/lodestar-config/mainnet";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {CachedBeaconState, createCachedBeaconState, IEpochProcess, prepareEpochProcessState} from "../../src/fast/util";
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
  let cachedState: CachedBeaconState;
  let process: IEpochProcess;
  const logger = new WinstonLogger();

  before(async function () {
    this.timeout(0);
    await initBLS();
    const origState = await generatePerformanceState();
    // go back 1 slot to process epoch
    origState.slot -= 1;
    cachedState = createCachedBeaconState(config, origState);
  });

  it("prepareEpochProcessState", async () => {
    const start = Date.now();
    logger.profile("prepareEpochProcessState");
    process = prepareEpochProcessState(cachedState);
    logger.profile("prepareEpochProcessState");
    expect(Date.now() - start).lte(60, "preparing EpochProcess takes longer than expected");
  });

  it("processJustificationAndFinalization", async () => {
    const start = Date.now();
    logger.profile("processJustificationAndFinalization");
    processJustificationAndFinalization(cachedState, process);
    logger.profile("processJustificationAndFinalization");
    expect(Date.now() - start).lte(2, "processing justification and finalization takes longer than expected");
  });

  it("processRewardsAndPenalties", async () => {
    const start = Date.now();
    logger.profile("processRewardsAndPenalties");
    processRewardsAndPenalties(cachedState, process);
    logger.profile("processRewardsAndPenalties");
    expect(Date.now() - start).lt(500, "processing rewards and penalties takes longer than expected");
  });

  it("processRegistryUpdates", async () => {
    const start = Date.now();
    logger.profile("processRegistryUpdates");
    processRegistryUpdates(cachedState, process);
    logger.profile("processRegistryUpdates");
    expect(Date.now() - start).lte(2, "processing registry updates takes longer than expected");
  });

  it("processSlashings", async () => {
    const start = Date.now();
    logger.profile("processSlashings");
    processSlashings(cachedState, process);
    logger.profile("processSlashings");
    expect(Date.now() - start).lte(25, "processing slashings takes longer than expected");
  });

  it("processFinalUpdates", async () => {
    const start = Date.now();
    logger.profile("processFinalUpdates");
    processFinalUpdates(cachedState, process);
    logger.profile("processFinalUpdates");
    expect(Date.now() - start).lte(30, "processing final update takes longer than expected");
  });

  it("processForkChanged", async () => {
    const start = Date.now();
    logger.profile("processForkChanged");
    processForkChanged(cachedState, process);
    logger.profile("processForkChanged");
    expect(Date.now() - start).lte(2, "processing fork change takes longer than expected");
  });
});
