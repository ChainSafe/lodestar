import {ChainForkConfig} from "@lodestar/config";
import {IClock} from "@lodestar/state-transition";
import {Epoch} from "@lodestar/types";
import {LoggerVc} from "../util/index.js";

export function pollGasLimitSchedule(config: ChainForkConfig, logger: LoggerVc, clock: IClock): void {
  let activeScheduledGasLimit: number | undefined;

  async function logActiveGasLimitSchedule(epoch: Epoch): Promise<void> {
    const scheduledGasLimit = config.getScheduledGasLimit(epoch);
    if (scheduledGasLimit !== undefined && scheduledGasLimit !== activeScheduledGasLimit) {
      logger.info("Gas limit schedule active", {epoch, gasLimit: scheduledGasLimit});
      activeScheduledGasLimit = scheduledGasLimit;
    }
  }

  clock.runEveryEpoch(logActiveGasLimitSchedule);
}
