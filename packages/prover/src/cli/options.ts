import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {LogLevel, LogLevels} from "@lodestar/utils";
import {ACTIVE_PRESET} from "@lodestar/params";
import {CliCommandOptions} from "../utils/command.js";

export type GlobalArgs = {
  network: string;
  logLevel: string;
  presetFile?: string;
  preset: string;
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

  logLevel: {
    description: "Set the log level.",
    type: "string",
    choices: LogLevels,
    default: "info",
  },

  // hidden option to allow for LODESTAR_PRESET to be set
  preset: {
    hidden: true,
    type: "string",
    default: ACTIVE_PRESET,
  },

  presetFile: {
    hidden: true,
    description: "Preset configuration file to override the active preset with custom values",
    type: "string",
  },
};

export function parseGlobalArgs(args: GlobalArgs): GlobalOptions {
  // Remove undefined values to allow deepmerge to inject default values downstream
  return {
    network: args.network as NetworkName,
    logLevel: args.logLevel as LogLevel,
  };
}
