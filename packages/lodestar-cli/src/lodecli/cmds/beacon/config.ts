import {Json} from "@chainsafe/ssz";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import _yargs from "yargs/yargs";

import {readFile, writeFile, getSubObject, setSubObject} from "../../util";

import {beaconRunOptions, IBeaconArgs} from "./options";

export function createBeaconConfig(args: IBeaconArgs): Partial<IBeaconNodeOptions> {
  const cliDefaults = _yargs().default(args).options(beaconRunOptions).parse([]) as Partial<IBeaconNodeOptions>;
  // cliDefaults contains a bunch of extra keys created from yargs' leniency
  // We only want to store the 'canonical' ones

  // take each option's first alias as the 'preferred' form
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

export async function readBeaconConfig(filename: string): Promise<Partial<IBeaconNodeOptions>> {
  return readFile(filename) as Partial<IBeaconNodeOptions>;
}

export async function initBeaconConfig(filename: string, args: IBeaconArgs): Promise<void> {
  await writeBeaconConfig(filename, createBeaconConfig(args));
}
