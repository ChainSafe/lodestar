import {Logger} from "@lodestar/utils";
import {getBrowserLogger} from "@lodestar/logger/browser";
import {getEmptyLogger} from "@lodestar/logger/empty";
import {LogOptions} from "../interfaces.js";

export function getLogger(opts: LogOptions): Logger {
  if (opts.logger) return opts.logger;

  if (opts.logLevel) {
    return getBrowserLogger({level: opts.logLevel});
  }

  // For the case when user don't want to fill in the logs of consumer browser
  return getEmptyLogger();
}
