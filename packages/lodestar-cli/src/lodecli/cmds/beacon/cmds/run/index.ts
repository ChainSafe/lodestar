import {Argv} from "yargs";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";

import {beaconRunOptions, IBeaconArgs} from "../../options";
import {readBeaconConfig} from "../../config";

import {run} from "./run";
import * as fs from "fs";

export const command = "run";

export const description = "Run a lodestar beacon node";

export function builder(yargs: Argv<IBeaconArgs>): Argv<IBeaconArgs & Partial<IBeaconNodeOptions>> {
  const args = yargs.parse(process.argv, true as unknown as object, function() {});
  return yargs.options(beaconRunOptions).config(readBeaconConfig(args.config)) as unknown as Argv<IBeaconArgs & Partial<IBeaconNodeOptions>>;
}

export const handler = run;
