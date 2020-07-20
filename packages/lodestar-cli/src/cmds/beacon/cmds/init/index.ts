import {Argv} from "yargs";

import {parseArgs} from "../../../../util";
import {readBeaconConfig} from "../../config";
import {IBeaconArgs} from "../../options";
import {beaconInitOptions, IBeaconInitArgs} from "./options";
import {init} from "./init";

export const command = "init";

export const description = "Initialize lodestar beacon node";

export function builder(yargs: Argv<IBeaconArgs>): Argv<IBeaconArgs> {
  yargs.options(beaconInitOptions);
  const args = parseArgs(yargs) as IBeaconInitArgs;
  if (args.templateConfigFile) {
    yargs.config(readBeaconConfig(args.templateConfigFile));
  }
  return yargs as unknown as Argv<IBeaconArgs>;
}

export const handler = init;
