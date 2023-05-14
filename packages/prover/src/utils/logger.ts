import {Logger} from "@lodestar/utils";
import {getNodeLogger} from "@lodestar/logger/node";
import {getBrowserLogger} from "@lodestar/logger/browser";
import {getEmptyLogger} from "@lodestar/logger/empty";
import {LogOptions} from "../interfaces.js";

export function getLogger(opts: LogOptions): Logger {
  if (opts.logger) return opts.logger;

  // Code is running in the node environment
  if (opts.logLevel && process !== undefined) {
    // TODO for @nazarhussain: Any issue with pulling this code into the Web3Provider path?
    // Can we just use the console.log logger for all code paths?
    return getNodeLogger({level: opts.logLevel});
  }

  if (opts.logLevel && process === undefined) {
    return getBrowserLogger({level: opts.logLevel});
  }

  // For the case when user don't want to fill in the logs of consumer browser
  return getEmptyLogger();
}
