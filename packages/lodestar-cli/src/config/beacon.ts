import fs from "fs";
import _yargs from "yargs/yargs";
import deepmerge from "deepmerge";
import {Json} from "@chainsafe/ssz";
import {IBeaconNodeOptions} from "../options";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";
import {readFileSync, writeFile, getSubObject, setSubObject} from "../util";
import {IBeaconOptions, beaconOptions} from "../cmds/beacon/options";

export function createBeaconConfig(args: Partial<IBeaconNodeOptions>): Partial<IBeaconNodeOptions> {
  const cliDefaults = _yargs().default(args)
    .options(beaconOptions)
    .parse([]) as Partial<IBeaconNodeOptions>;
  // cliDefaults contains a bunch of extra keys created from yargs' leniency
  // don't create hidden options
  const config: Partial<IBeaconNodeOptions> = {};
  for (const [alias, option] of Object.entries(beaconOptions)) {
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
  const optionsFromFile = readBeaconConfig(options.configFile) as IBeaconOptions;

  return deepmerge(
    deepmerge(
      defaultOptions as Partial<IBeaconOptions>,
      optionsFromFile,
      {
        arrayMerge
      }
    ),
    options,
    {
      arrayMerge
    }
  );
}

export async function initBeaconConfig(filename: string, args: Partial<IBeaconNodeOptions>): Promise<void> {
  await writeBeaconConfig(filename, createBeaconConfig(args));
}

/**
 * If override array option (source) is defined and has items
 * replace target (original option).
 * Example: network.multiaddrs has default ['/ip4/127.0.0.1/tcp/30606'] and we don't wanna append to that with cli flag
 * as it could result in port taken
 * @param target
 * @param source
 */
function arrayMerge(target: unknown[], source: unknown[]): unknown[] {
  if(source.length === 0) {
    return target;
  }
  return source;
}
