import {Argv} from "yargs";

export const command = "beacon";

export const description = "Beacon node";

export function builder(yargs: Argv): Argv {
  return yargs.commandDir("beaconCmds");
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function handler(): void {}
