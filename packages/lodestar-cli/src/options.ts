import {Options} from "yargs";

export interface IGlobalArgs {
  rootDir: string;
}

export const rootDir: Options = {
  default: "./.lodestar",
  description: "Lodestar root directory",
  normalize: true,
  type: "string",
};

export const globalOptions = {rootDir};
