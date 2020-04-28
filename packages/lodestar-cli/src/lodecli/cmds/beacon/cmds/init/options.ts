import {Options} from "yargs";

import {canonicalOptions} from "../../../../util";
import {IBeaconArgs} from "../../options";

export interface IBeaconInitArgs extends IBeaconArgs {
  templateConfigFile?: string;
}

const templateConfig: Options = {
  alias: ["templateConfigFile", "templateConfig"],
  description: "Template configuration used to initialize beacon node",
  type: "string",
  default: null,
};

export const beaconInitOptions = canonicalOptions({templateConfig});
