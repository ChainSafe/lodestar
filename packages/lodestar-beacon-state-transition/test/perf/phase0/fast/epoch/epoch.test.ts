import {config} from "@chainsafe/lodestar-config/mainnet";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {generatePerformanceState, initBLS} from "../../../util";
import {expect} from "chai";
import {phase0} from "../../../../../src";

describe("Epoch Processing Performance Tests", function () {
  let state: phase0.fast.CachedBeaconState<phase0.BeaconState>;
  let process: phase0.fast.IEpochProcess;
  const logger = new WinstonLogger();

  before(async function () {
    this.timeout(0);
    await initBLS();
    const origState = await generatePerformanceState();
    // go back 1 slot to process epoch
    origState.slot -= 1;
    state = phase0.fast.createCachedBeaconState(config, origState);
  });

  it("prepareEpochProcessState", async () => {
    const start = Date.now();
    logger.profile("prepareEpochProcessState");
    process = phase0.fast.prepareEpochProcessState(state);
    logger.profile("prepareEpochProcessState");
    // not stable, sometimes < 1400, sometimes > 2000
    expect(Date.now() - start).lt(100);
  });

  it("processJustificationAndFinalization", async () => {
    const start = Date.now();
    logger.profile("processJustificationAndFinalization");
    phase0.fast.processJustificationAndFinalization(state, process);
    logger.profile("processJustificationAndFinalization");
    expect(Date.now() - start).lte(2);
  });

  it("processRewardsAndPenalties", async () => {
    const start = Date.now();
    logger.profile("processRewardsAndPenalties");
    phase0.fast.processRewardsAndPenalties(state, process);
    logger.profile("processRewardsAndPenalties");
    expect(Date.now() - start).lt(250);
  });

  it("processRegistryUpdates", async () => {
    const start = Date.now();
    logger.profile("processRegistryUpdates");
    phase0.fast.processRegistryUpdates(state, process);
    logger.profile("processRegistryUpdates");
    expect(Date.now() - start).lte(2);
  });

  it("processSlashings", async () => {
    const start = Date.now();
    logger.profile("processSlashings");
    phase0.fast.processSlashings(state, process);
    logger.profile("processSlashings");
    expect(Date.now() - start).lte(25);
  });

  it("processFinalUpdates", async () => {
    const start = Date.now();
    logger.profile("processFinalUpdates");
    phase0.fast.processFinalUpdates(state, process);
    logger.profile("processFinalUpdates");
    expect(Date.now() - start).lte(30);
  });
});
