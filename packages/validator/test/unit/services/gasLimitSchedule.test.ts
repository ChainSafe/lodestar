import {describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {pollGasLimitSchedule} from "../../../src/services/gasLimitSchedule.js";
import {ClockMock} from "../../utils/clock.js";
import {getMockedLogger} from "../../utils/logger.js";

describe("pollGasLimitSchedule", () => {
  it("logs when a scheduled gas limit becomes active", async () => {
    const config = createChainForkConfig({
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
    });
    const clock = new ClockMock();
    const logger = {...getMockedLogger(), isSyncing: vi.fn()};
    const signal = new AbortController().signal;

    pollGasLimitSchedule(config, logger, clock);

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
