import {Options} from "yargs";
import {defaultGlobalPaths} from "../paths/global";
import {paramsOptions, IParamsArgs} from "./paramsOptions";
import {TestnetName} from "../testnets";

export type IGlobalArgs = {
  rootDir: string;
  testnet?: TestnetName;
  preset: string;
  paramsFile: string;
} & IParamsArgs;

export const globalOptions = {
  rootDir: {
    description: "Lodestar root directory",
    normalize: true,
    type: "string"
  } as Options,

  testnet: {
    description: "Use a testnet configuration",
    type: "string",
    choices: ["altona", "medalla"] as TestnetName[],
  } as Options,

  preset: {
    description: "Specifies the default eth2 spec type",
    choices: ["mainnet", "minimal"],
    default: "mainnet",
    type: "string"
  } as Options,

  paramsFile: {
    description: "Network configuration file",
    defaultDescription: defaultGlobalPaths.paramsFile,
    type: "string",
  } as Options,

  ...paramsOptions,
};
