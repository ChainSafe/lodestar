import {Json} from "@chainsafe/ssz";
import defaults, {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";

import {readFile, writeFile} from "../lodestar/util";
import {BeaconNodeOptions} from "../lodestar/node/options";
import {generateTomlConfig} from "../lodestar/util/toml";
import {validateConfig} from "../lodestar/util/config";

export function createConfig(): IBeaconNodeOptions {
  return {...defaults};
}

export async function writeConfig(filename: string, config: IBeaconNodeOptions): Promise<void> {
  await writeFile(filename, generateTomlConfig(config, BeaconNodeOptions) as Json);
}

export async function readConfig(filename: string): Promise<IBeaconNodeOptions> {
  return validateConfig<IBeaconNodeOptions>(await readFile(filename), BeaconNodeOptions) as IBeaconNodeOptions;
}

export async function initConfig(filename: string): Promise<void> {
  await writeConfig(filename, createConfig());
}
