import {Argv} from "yargs";

import {IGlobalArgs} from "../../options";

import {mergeBeaconOptions} from "./options";
import * as init from "./cmds/init";
import * as run from "./cmds/run";

export const command = "beacon <command>";

export const description = "Beacon node";

export function builder(yargs: Argv<IGlobalArgs>): Argv {
  return mergeBeaconOptions(yargs)
    .command(init)
    .command(run)
    .help();
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function handler(): void {
}
