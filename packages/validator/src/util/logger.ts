import {HttpError} from "@chainsafe/lodestar-api";
import {LogData, ILogger, isErrorAborted} from "@chainsafe/lodestar-utils";
import {IClock} from "./clock.js";

export type ILoggerVc = Pick<ILogger, "error" | "warn" | "info" | "verbose" | "debug"> & {
  isSyncing(e: Error): void;
};

export function getLoggerVc(logger: ILogger, clock: IClock): ILoggerVc {
  let hasLogged = false;

  clock.runEverySlot(async () => {
    if (hasLogged) hasLogged = false;
  });

  return {
    error(message: string, context?: LogData, e?: Error) {
      if (e) {
        // Returns true if it's an network error with code 503 = Node is syncing
        // https://github.com/ethereum/beacon-APIs/blob/e68a954e1b6f6eb5421abf4532c171ce301c6b2e/types/http.yaml#L62
        if (e instanceof HttpError && e.status === 503) {
          this.isSyncing(e);
        }
        // Only log if arg `e` is not an instance of `ErrorAborted`
        else if (!isErrorAborted(e)) {
          logger.error(message, context, e);
        }
      } else {
        logger.error(message, context, e);
      }
    },

    // error: logger.error.bind(logger),
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
