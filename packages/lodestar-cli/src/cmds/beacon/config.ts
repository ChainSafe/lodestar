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
    // handle duck typed access to a subobject
    const preferredNameArr = alias.split(".");
    const value = getSubObject(cliDefaults, preferredNameArr);
    if (value !== undefined && (value !== option.default || !option.hidden)) {
      setSubObject(config, preferredNameArr, value);
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
  try {
    return readFileSync(filename) as Partial<IBeaconNodeOptions>;
  } catch(e) {
    return {};
  }
}

export async function initBeaconConfig(filename: string, args: IBeaconArgs): Promise<void> {
  await writeBeaconConfig(filename, createBeaconConfig(args));
}
