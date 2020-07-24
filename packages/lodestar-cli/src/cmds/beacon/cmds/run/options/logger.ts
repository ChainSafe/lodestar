import {LogLevel, LogLevels} from "@chainsafe/lodestar-utils/lib/logger";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";
import {IYargsOptionsMap} from "../../../../../util/yargs";

/**
 * Generates an option for each module in defaultOptions.logger
 * chain, db, eth1, etc
 */
export const loggerOptions: IYargsOptionsMap = Object.keys(defaultOptions.logger).reduce(
  (options: IYargsOptionsMap, logModule) => {
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
