import {Logger} from "@lodestar/utils";
import {getEmptyLogger} from "@lodestar/logger/empty";
import {getEnvLogger} from "@lodestar/logger/env";
import {LogOptions} from "../interfaces.js";

export function getLogger(opts: LogOptions): Logger {
  if (opts.logger) return opts.logger;

  if (opts.logLevel) {
    return getEnvLogger({level: opts.logLevel});
  }

  // For the case when user don't want to fill in the logs of consumer browser
  return getEmptyLogger();
}
