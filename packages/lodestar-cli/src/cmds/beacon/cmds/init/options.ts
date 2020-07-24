import {Options} from "yargs";
import {IBeaconArgs} from "../../options";
import {paramsOptions} from "../run/options/params";

export interface IBeaconInitArgs extends IBeaconArgs {
  templateConfigFile?: string;
}

const templateConfig: Options = {
  alias: ["templateConfigFile", "templateConfig"],
  description: "Template configuration used to initialize beacon node",
  type: "string",
  default: null,
};

export const beaconInitOptions = {templateConfig, ...paramsOptions};