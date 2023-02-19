import {ACTIVE_PRESET} from "@lodestar/params";
import {NetworkName, networkNames} from "../networks/index.js";
import {CliCommandOptions, readFile} from "../util/index.js";
import {paramsOptions, IParamsArgs} from "./paramsOptions.js";

type GlobalSingleArgs = {
  dataDir?: string;
  network?: NetworkName;
  paramsFile: string;
  preset: string;
};

export const defaultNetwork: NetworkName = "mainnet";

const globalSingleOptions: CliCommandOptions<GlobalSingleArgs> = {
  dataDir: {
    description: "Lodestar root data directory",
    type: "string",
  },

  network: {
    description: "Name of the Ethereum Consensus chain network to join",
    type: "string",
    defaultDescription: defaultNetwork,
    choices: networkNames,
  },

  paramsFile: {
    description: "Network configuration file",
    type: "string",
  },

  // hidden option to allow for LODESTAR_PRESET to be set
  preset: {
    hidden: true,
    type: "string",
    default: ACTIVE_PRESET,
  },
};

export const rcConfigOption: [string, string, (configPath: string) => Record<string, unknown>] = [
  "rcConfig",
  "RC file to supplement command line args, accepted formats: .yml, .yaml, .json",
  (configPath: string): Record<string, unknown> => readFile(configPath, ["json", "yml", "yaml"]),
];

export type GlobalArgs = GlobalSingleArgs & IParamsArgs;

export const globalOptions = {
  ...globalSingleOptions,
  ...paramsOptions,
};
