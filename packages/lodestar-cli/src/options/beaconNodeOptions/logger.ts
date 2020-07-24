import {Options} from "yargs";
import {LogLevel, LogLevels} from "@chainsafe/lodestar-utils/lib/logger";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";

/**
 * Generates an option for each module in defaultOptions.logger
 * chain, db, eth1, etc
 */
export const loggerOptions = Object.keys(defaultOptions.logger).reduce(
  (options: Record<string, Options>, logModule) => {
    options[`logger.${logModule}.level`] = {
      alias: [`log.${logModule}.level`],
      hidden: true,
      type: "string",
      choices: LogLevels,
      default: LogLevel.info,
      group: "log",
    };
    return options;
  }, 
  {}
);
