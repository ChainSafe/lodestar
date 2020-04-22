import {Options} from "yargs";

export const rootDir: Options = {
  default: "./.lodecli",
  description: "Lodecli root directory",
  type: "string",
};
