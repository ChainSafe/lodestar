import {Argv} from "yargs";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";

import {parseArgs} from "../../../../util";
import {IBeaconArgs} from "../../options";
import {readBeaconConfig} from "../../config";

import {beaconRunOptions} from "./options";
import {run} from "./run";

export const command = "run";

export const description = "Run a lodestar beacon node";

export function builder(yargs: Argv<IBeaconArgs>): Argv<IBeaconArgs & Partial<IBeaconNodeOptions>> {
  const args = parseArgs(yargs);
  return yargs
    .options(beaconRunOptions)
    .config(readBeaconConfig(args.config)) as unknown as Argv<IBeaconArgs & Partial<IBeaconNodeOptions>>;
}

export const handler = run;
