import {Options} from "yargs";

export interface IGlobalArgs {
  rootDir: string;
}

export const rootDir: Options = {
  default: "./.lodecli",
  description: "Lodecli root directory",
  hidden: true,
  normalize: true,
  type: "string",
};
