import {Arguments, Argv, PositionalOptions} from "yargs";

import {init} from "../../../commands/init/init";

import {lodecliRootDir} from "../../options";

export const command = "init [lodecli-root-dir]";

export const description = "Initialize beacon node";

interface IBeaconInitArgs {
  lodecliRootDir: string;
}

export function builder(yargs: Argv): Argv {
  return yargs.positional("lodecliRootDir", lodecliRootDir as PositionalOptions);
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export async function handler(args: Arguments<IBeaconInitArgs>): Promise<void> {
  await init(args.lodecliRootDir);
}
