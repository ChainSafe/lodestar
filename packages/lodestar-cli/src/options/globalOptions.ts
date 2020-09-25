import {defaultGlobalPaths} from "../paths/global";
import {paramsOptions, IParamsArgs} from "./paramsOptions";
import {TestnetName, testnetNames} from "../testnets";
import {ICliCommandOptions} from "../util";

interface IGlobalSingleArgs {
  rootDir: string;
  testnet?: TestnetName;
  preset: string;
  paramsFile: string;
}

const globalSingleOptions: ICliCommandOptions<IGlobalSingleArgs> = {
  rootDir: {
    description: "Lodestar root directory",
    normalize: true,
    type: "string",
  },

  testnet: {
    description: "Use a testnet configuration",
    type: "string",
    choices: testnetNames,
  },

  preset: {
    description: "Specifies the default eth2 spec type",
    choices: ["mainnet", "minimal"],
    default: "mainnet",
    type: "string",
  },

  paramsFile: {
    description: "Network configuration file",
    defaultDescription: defaultGlobalPaths.paramsFile,
    type: "string",
  },
};

export type IGlobalArgs = IGlobalSingleArgs & IParamsArgs;

export const globalOptions = {
  ...globalSingleOptions,
  ...paramsOptions,
};
