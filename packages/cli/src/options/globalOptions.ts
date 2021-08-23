import {defaultGlobalPaths} from "../paths/global";
import {paramsOptions, IParamsArgs} from "./paramsOptions";
import {NetworkName, networkNames} from "../networks";
import {ICliCommandOptions} from "../util";

interface IGlobalSingleArgs {
  rootDir: string;
  network: NetworkName;
  paramsFile: string;
}

interface IGlobalDevArgs {
  rootDir: string;
  paramsFile: string;
}

export const defaultNetwork: NetworkName = "mainnet";

const globalSingleOptions: ICliCommandOptions<IGlobalSingleArgs> = {
  rootDir: {
    description: "Lodestar root directory",
    type: "string",
  },

  network: {
    description: "Name of the Eth2 chain network to join",
    type: "string",
    default: defaultNetwork,
    choices: networkNames,
  },

  paramsFile: {
    description: "Network configuration file",
    defaultDescription: defaultGlobalPaths.paramsFile,
    type: "string",
  },
};

const globalDevOptions: ICliCommandOptions<IGlobalDevArgs> = {
  rootDir: {
    description: "Lodestar root directory",
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

export const devOptions = {
  ...globalDevOptions,
  ...paramsOptions,
};
