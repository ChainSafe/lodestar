import {Options} from "yargs";

export const lodecliRootDir: Options = {
  default: "./.lodecli",
  description: "Lodecli root directory",
  type: "string",
};
