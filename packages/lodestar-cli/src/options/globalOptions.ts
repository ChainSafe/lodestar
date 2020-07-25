import {Options} from "yargs";

export interface IGlobalArgs {
  rootDir: string;
  preset: string;
}

export const globalOptions = {
  rootDir: {
    default: "./.lodestar",
    description: "Lodestar root directory",
    normalize: true,
    type: "string"
  } as Options,

  preset: {
    description: "Specifies the default eth2 spec type",
    type: "string",
    choices: ["mainnet", "minimal"],
    defaultDescription: "mainnet"
  } as Options
};
