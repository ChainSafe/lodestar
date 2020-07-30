import fs from "fs";
import _yargs from "yargs/yargs";
import deepmerge from "deepmerge";
import {Json} from "@chainsafe/ssz";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";
import {readFileSync, writeFile, getSubObject, setSubObject} from "../../util";
import {IBeaconOptions, beaconOptions, genesisStateFile} from "./options";
import { beaconNodeOptions, paramsOptions } from "../../options";
import { Options } from "read-pkg-up";

export function createBeaconConfig(args: Partial<IBeaconNodeOptions>): Partial<IBeaconNodeOptions> {
  const beaconConfigOptions = {
    ...beaconNodeOptions,
    ...paramsOptions,
    genesisStateFile,
  };
  const cliDefaults = _yargs().default(args)
    .options(beaconConfigOptions)
    .parse([]) as Partial<IBeaconNodeOptions>;
  // cliDefaults contains a bunch of extra keys created from yargs' leniency
  // don't create hidden options
  const config: Partial<IBeaconNodeOptions> = {};
  for (const [alias, option] of Object.entries(beaconConfigOptions)) {
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
 * If the config file is not found, the default values will apply.
 */
export function readBeaconConfig(filename: string): Partial<IBeaconNodeOptions> {
  if (fs.existsSync(filename)) {
    return readFileSync(filename) as Partial<IBeaconNodeOptions>;
  } else {
    return {};
  }
}

/**
 * Reads config files and merges their options with default options and user options
 * @param options 
 */
export function mergeConfigOptions(options: IBeaconOptions): IBeaconOptions {
  const optionsFromFile = deepmerge(
    readBeaconConfig(options.templateConfigFile),
    readBeaconConfig(options.configFile)
  ) as IBeaconOptions;

  return deepmerge(
    deepmerge(
      defaultOptions as IBeaconOptions,
      optionsFromFile
    ),
    options
  );
}

export async function initBeaconConfig(filename: string, args: Partial<IBeaconNodeOptions>): Promise<void> {
  await writeBeaconConfig(filename, createBeaconConfig(args));
}
