import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {LogLevel, LogLevels} from "@lodestar/utils";
import {CliCommandOptions} from "../utils/command.js";

export type GlobalArgs = {
  network: string;
  "log-level": string;
};

export type GlobalOptions = {
  logLevel: LogLevel;
  network: NetworkName;
};

export const globalOptions: CliCommandOptions<GlobalArgs> = {
  network: {
    description: "Specify the network to connect.",
    type: "string",
    choices: Object.keys(networksChainConfig),
  },

  "log-level": {
    description: "Set the log level.",
    type: "string",
    choices: LogLevels,
    default: "info",
  },
};

export function parseGlobalArgs(args: GlobalArgs): GlobalOptions {
  // Remove undefined values to allow deepmerge to inject default values downstream
  return {
    network: args["network"] as NetworkName,
    logLevel: args["log-level"] as LogLevel,
  };
}
