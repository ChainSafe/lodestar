import {Options} from "yargs";
import {LogLevel, LogLevels} from "@chainsafe/lodestar-utils";
import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ICliCommandOptions, ObjectKeys} from "../../util";

// No options are statically declared
// If an arbitraty key notation is used, it removes typesafety on most of the CLI arg parsing code.
// Params will be parsed from an args object assuming to contain the required keys
export type ILoggerArgs = Record<string, unknown>;

const getArgKey = (logModule: keyof IBeaconNodeOptions["logger"]): keyof ILoggerArgs =>
  `logger.${logModule}.level` as keyof ILoggerArgs;

export function parseArgs(args: ILoggerArgs): Partial<IBeaconNodeOptions["logger"]> {
  return ObjectKeys(defaultOptions.logger).reduce((options: Partial<IBeaconNodeOptions["logger"]>, logModule) => {
    const level = args[getArgKey(logModule)];
    if (level) options[logModule] = {level: LogLevel[level as LogLevel]};
    return options;
  }, {});
}

/**
 * Generates an option for each module in defaultOptions.logger
 * chain, db, eth1, etc
 */
export const options: ICliCommandOptions<ILoggerArgs> = ObjectKeys(defaultOptions.logger).reduce(
  (options: Record<string, Options>, logModule): Record<string, Options> => ({
    ...options,
    [getArgKey(logModule)]: {
      hidden: true,
      type: "string",
      choices: LogLevels,
      description: `Logging verbosity level for ${logModule}`,
      defaultDescription: (defaultOptions.logger[logModule] ?? {}).level,
      group: "log",
    },
  }),
  {}
);
