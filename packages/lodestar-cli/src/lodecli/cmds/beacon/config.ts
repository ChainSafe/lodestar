import _yargs from "yargs/yargs";
import {Json} from "@chainsafe/ssz";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";

import {readFileSync, writeFile, getSubObject, setSubObject} from "../../util";
import {mergeBeaconOptions, IBeaconArgs} from "./options";
import {beaconRunOptions} from "./cmds/run/options";

export function createBeaconConfig(args: IBeaconArgs): Partial<IBeaconNodeOptions> {
  const cliDefaults = mergeBeaconOptions(_yargs().default(args))
    .options(beaconRunOptions)
    .parse([]) as Partial<IBeaconNodeOptions>;
  // cliDefaults contains a bunch of extra keys created from yargs' leniency
  // don't create hidden options
  const config: Partial<IBeaconNodeOptions> = {};
  for (const [alias, option] of Object.entries(beaconRunOptions)) {
    if (!option.hidden && option.default !== undefined) {
      // handle duck typed access to a subobject
      const preferredNameArr = alias.split(".");
      setSubObject(config, preferredNameArr, getSubObject(cliDefaults, preferredNameArr));
    }
  }
  return config;
}

export async function writeBeaconConfig(filename: string, config: Partial<IBeaconNodeOptions>): Promise<void> {
  await writeFile(filename, config as Json);
}

/**
 * This needs to be a synchronous function because it will be run as part of the yargs 'build' step
 */
export function readBeaconConfig(filename: string): Partial<IBeaconNodeOptions> {
  return readFileSync(filename) as Partial<IBeaconNodeOptions>;
}

export async function initBeaconConfig(filename: string, args: IBeaconArgs): Promise<void> {
  await writeBeaconConfig(filename, createBeaconConfig(args));
}
