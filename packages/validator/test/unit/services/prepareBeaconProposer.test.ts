import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {pollBuilderValidatorRegistration} from "../../../src/services/prepareBeaconProposer.js";
import {getApiClientStub} from "../../utils/apiStub.js";
import {ClockMock} from "../../utils/clock.js";
import {getMockedLogger} from "../../utils/logger.js";
import {initValidatorStore} from "../../utils/validatorStore.js";

describe("pollBuilderValidatorRegistration", () => {
  it("logs when a scheduled gas limit becomes active", async () => {
    const customChainConfig = {
      ...chainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 2,
      GAS_LIMIT_SCHEDULE: [
        {EPOCH: 2, GAS_LIMIT: 75_000_000},
        {EPOCH: 3, GAS_LIMIT: 90_000_000},
      ],
    };
    const config = createBeaconConfig(customChainConfig, new Uint8Array(32));
    const api = getApiClientStub();
    const clock = new ClockMock();
    const logger = {...getMockedLogger(), isSyncing: vi.fn()};
    const validatorStore = await initValidatorStore([], api, customChainConfig);
    const signal = new AbortController().signal;

    pollBuilderValidatorRegistration(config, logger, api, clock, validatorStore, null);

    await clock.tickEpochFns(1, signal);
    expect(logger.info).not.toHaveBeenCalled();

    await clock.tickEpochFns(2, signal);
    expect(logger.info).toHaveBeenCalledWith("Gas limit schedule active", {epoch: 2, gasLimit: 75_000_000});

    await clock.tickEpochFns(2, signal);
    expect(logger.info).toHaveBeenCalledTimes(1);

    await clock.tickEpochFns(3, signal);
    expect(logger.info).toHaveBeenNthCalledWith(2, "Gas limit schedule active", {
      epoch: 3,
      gasLimit: 90_000_000,
    });
  });
});
