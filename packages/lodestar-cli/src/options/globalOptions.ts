import {Options} from "yargs";

export interface IGlobalArgs {
  rootDir: string;
  preset: string;
}

export const globalOptions = {
  rootDir: {
    description: "Lodestar root directory",
    normalize: true,
    default: "./.lodestar",
    type: "string"
  } as Options,

  preset: {
    description: "Specifies the default eth2 spec type",
    choices: ["mainnet", "minimal"],
    default: "mainnet",
    type: "string"
  } as Options
};
