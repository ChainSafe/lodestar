import {Json} from "@chainsafe/ssz";
import defaults, {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import _yargs from "yargs/yargs";

import {readFile, writeFile} from "../../util";

import {beaconRunOptions, IBeaconArgs} from "./options";


export function createBeaconConfig(args: IBeaconArgs): Partial<IBeaconNodeOptions> {
  const cliDefaults = _yargs().default(args).options(beaconRunOptions).parse([]) as Partial<IBeaconNodeOptions>;
  // cliDefaults contains a bunch of extra keys created from yargs' leniency
  // We only want to store the 'canonical' ones
  // Remove any nested keys that contain hyphens or are not in the template object
  const removeSuperfluousKeys = (obj: any, templateObj: any): void => {
    if (obj && typeof obj === "object") {
      for (const k of Object.keys(obj)) {
        if (k.indexOf("-") === -1 && templateObj[k] !== undefined) {
          removeSuperfluousKeys(obj[k], templateObj[k]);
        } else {
          delete obj[k];
        }
      }
    }
  };
  removeSuperfluousKeys(cliDefaults, defaults);
  return cliDefaults;
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
