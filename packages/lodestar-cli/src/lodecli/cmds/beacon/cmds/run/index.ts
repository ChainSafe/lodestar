import {Argv} from "yargs";

import {IGlobalArgs} from "../../../../options";

import {beaconRunOptions} from "../../options";

import {IBeaconRunArgs, run} from "./run";

export const command = "run";

export const description = "Run a beacon node";

export function builder(yargs: Argv<IGlobalArgs>): Argv<IBeaconRunArgs> {
  return yargs.options(beaconRunOptions) as unknown as Argv<IBeaconRunArgs>;
}

export const handler = run;
