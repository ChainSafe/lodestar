import {Arguments, Argv, PositionalOptions} from "yargs";

import {init} from "./init";

import {rootDir} from "../../../../options";

export interface IBeaconInitArgs {
  rootDir: string;
}

export const command = "init [rootDir]";

export const description = "Initialize beacon node";

export function builder(yargs: Argv): Argv<IBeaconInitArgs> {
  return yargs.positional("rootDir", rootDir as PositionalOptions) as Argv<IBeaconInitArgs>;
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export async function handler(args: Arguments<IBeaconInitArgs>): Promise<void> {
  await init(args.rootDir);
  console.log("done")
}
