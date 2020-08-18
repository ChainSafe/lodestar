import {Options} from "yargs";
import {LogLevels} from "@chainsafe/lodestar-utils/lib/logger";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";

type LoggerModule = keyof typeof defaultOptions.logger;

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
      description: `Logging verbosity level for ${logModule}`,
      defaultDescription: (defaultOptions.logger[logModule as LoggerModule] || {}).level,
      group: "log",
    };
    return options;
  }, 
  {}
);
