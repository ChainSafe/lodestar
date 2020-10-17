import {Options} from "yargs";
import {LogLevel, LogLevels} from "@chainsafe/lodestar-utils";
import defaultOptions, {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {ICliCommandOptions} from "../../util";

const getArgKey = (logModule: keyof IBeaconNodeOptions["logger"]): keyof IArgs =>
  `logger.${logModule}.level` as keyof IArgs;

export interface IArgs {
  "logger.chain.level": string;
  "logger.db.level": string;
  "logger.eth1.level": string;
  "logger.node.level": string;
  "logger.network.level": string;
  "logger.sync.level": string;
  "logger.api.level": string;
  "logger.metrics.level": string;
  "logger.chores.level": string;
}

type LoggerModule = keyof typeof defaultOptions.logger;

export function parseArgs(args: IArgs): Partial<IBeaconNodeOptions["logger"]> {
  return Object.keys(defaultOptions.logger).reduce((options: Partial<IBeaconNodeOptions["logger"]>, logModule) => {
    const logModuleKey = logModule as keyof IBeaconNodeOptions["logger"];
    const level = args[getArgKey(logModuleKey)];
    if (level) options[logModuleKey] = {level: LogLevel[level as LogLevel]};
    return options;
  }, {});
}

/**
 * Generates an option for each module in defaultOptions.logger
 * chain, db, eth1, etc
 */
export const options: ICliCommandOptions<IArgs> = Object.keys(defaultOptions.logger).reduce((options, logModule) => {
  const logModuleKey = logModule as keyof IBeaconNodeOptions["logger"];
  options[getArgKey(logModuleKey)] = {
    hidden: true,
    type: "string",
    choices: LogLevels,
    description: `Logging verbosity level for ${logModule}`,
    defaultDescription: (defaultOptions.logger[logModule as LoggerModule] || {}).level,
    group: "log",
  };
  return options;
}, {} as {[key in keyof IArgs]: Options});
