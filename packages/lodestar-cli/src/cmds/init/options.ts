import {Options} from "yargs";
import {beaconOptions, IBeaconOptions} from "../beacon/options";

export type IInitOptions =
  IBeaconOptions &
  {
    templateConfigFile?: string;
  };

export const initOptions: {[k: string]: Options} = {
  ...beaconOptions,

  templateConfigFile: {
    alias: ["templateConfigFile", "templateConfig"],
    description: "Template configuration used to initialize beacon node",
    type: "string",
    default: null,
  },
};
