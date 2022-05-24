import {paramsOptions, IParamsArgs} from "./paramsOptions.js";
import {NetworkName, networkNames} from "../networks/index.js";
import {ICliCommandOptions, readFile} from "../util/index.js";

interface IGlobalSingleArgs {
  rootDir: string;
  network: NetworkName;
  paramsFile: string;
  preset: string;
}

export const defaultNetwork: NetworkName = "mainnet";

const globalSingleOptions: ICliCommandOptions<IGlobalSingleArgs> = {
  rootDir: {
    description: "Lodestar root directory",
    type: "string",
  },

  network: {
    description: "Name of the Ethereum Consensus chain network to join",
    type: "string",
    default: defaultNetwork,
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
  },
};

export const rcConfigOption: [string, string, (configPath: string) => Record<string, unknown>] = [
  "rcConfig",
  "RC file to supplement command line args, accepted formats: .yml, .yaml, .json",
  (configPath: string): Record<string, unknown> => readFile(configPath, ["json", "yml", "yaml"]),
];

export type IGlobalArgs = IGlobalSingleArgs & IParamsArgs;

export const globalOptions = {
  ...globalSingleOptions,
  ...paramsOptions,
};
