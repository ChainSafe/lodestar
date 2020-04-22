import {Argv} from "yargs";

import * as init from "./cmds/init";

export const command = "beacon <command>";

export const description = "Beacon node";

export function builder(yargs: Argv): Argv {
  return yargs
    .command(init)
    .help();
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function handler(): void {
}
