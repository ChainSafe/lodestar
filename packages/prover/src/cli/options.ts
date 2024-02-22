import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {CliCommandOptions, LogLevel, LogLevels} from "@lodestar/utils";
import {ACTIVE_PRESET} from "@lodestar/params";
import {YargsError} from "../utils/errors.js";

export type GlobalArgs = {
  network?: string;
  logLevel: string;
  presetFile?: string;
  preset: string;
  paramsFile?: string;
};

export type GlobalOptions = {
  logLevel: LogLevel;
} & ({paramsFile: string; network?: never} | {network: NetworkName; paramsFile?: never});

export const globalOptions: CliCommandOptions<GlobalArgs> = {
  network: {
    description: "Specify the network to connect.",
    type: "string",
    choices: [
      ...Object.keys(networksChainConfig), // Leave always as last network. The order matters for the --help printout
      "dev",
    ],
    conflicts: ["paramsFile"],
  },

  paramsFile: {
    description: "Network configuration file",
    type: "string",
    conflicts: ["network"],
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
  if (args.network) {
    return {
      network: args.network as NetworkName,
      logLevel: args.logLevel as LogLevel,
    };
  }

  if (args.paramsFile) {
    return {
      logLevel: args.logLevel as LogLevel,
      paramsFile: args.paramsFile,
    };
  }

  throw new YargsError("Either --network or --paramsFile must be provided");
}
