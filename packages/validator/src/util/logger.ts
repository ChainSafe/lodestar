import {ILogger} from "@chainsafe/lodestar-utils";
import {IClock} from "./clock";

export type ILoggerVc = Pick<ILogger, "error" | "warn" | "info" | "verbose" | "debug"> & {
  isSyncing(e: Error): void;
};

export function getLoggerVc(logger: ILogger, clock: IClock): ILoggerVc {
  let hasLogged = false;

  clock.runEverySlot(async () => {
    if (hasLogged) hasLogged = false;
  });

  return {
    error: logger.error.bind(logger),
    warn: logger.warn.bind(logger),
    info: logger.info.bind(logger),
    verbose: logger.verbose.bind(logger),
    debug: logger.debug.bind(logger),

    /**
     * Throttle "node is syncing" errors to not pollute the console too much.
     * Logs once per slot at most.
     */
    isSyncing(e: Error) {
      if (!hasLogged) {
        hasLogged = true;
        // Log the full error message, in case the server returns 503 for some unknown reason
        logger.info(`Node is syncing - ${e.message}`);
      }
    },
  };
}
