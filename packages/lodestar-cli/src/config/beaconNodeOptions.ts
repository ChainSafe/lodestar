import fs from "fs";
import _yargs from "yargs/yargs";
import deepmerge from "deepmerge";
import {Json} from "@chainsafe/ssz";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";
import {IBeaconNodeOptions} from "../options";
import {readFileSync, writeFile, getSubObject, setSubObject, RecursivePartial} from "../util";
import {IBeaconArgs, beaconOptions} from "../cmds/beacon/options";
import {getTestnetConfig, TestnetName} from "../testnets";

/**
 * Reads, parses and merges BeaconNodeOptions from:
 * - CLI args
 * - existing config file
 * - default values
 */
export function processBeaconNodeOptions({
  beaconNodeArgs,
  configFile,
  testnet,
}: {
  beaconNodeArgs: RecursivePartial<IBeaconNodeOptions>;
  configFile?: string;
  testnet?: TestnetName;
}): IBeaconNodeOptions {
  return mergeBeaconNodeOptions(
    // All required properties are defined
    defaultOptions,
    // Required properties may not be defined
    beaconNodeArgs,
    configFile ? readBeaconConfig(configFile) : {},
    testnet ? getTestnetConfig(testnet) : {}
  );
}

export async function initializeBeaconNodeOptions(testnet?: TestnetName) {
  // Auto-setup testnet
  if (testnet) {
    try {
      if (!testnetConfig.network) testnetConfig.network = {};
      if (!testnetConfig.network.discv5) testnetConfig.network.discv5 = {} as IDiscv5DiscoveryInputOptions;
      testnetConfig.network.discv5.bootEnrs = await fetchBootnodes(args.testnet);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Error fetching latest bootnodes: ${e.stack}`);
    }
  }

  // Only download files if params file does not exist
  if (!fs.existsSync(beaconPaths.paramsFile)) {
    const paramsUrl = getTestnetParamsUrl(args.testnet);
    if (paramsUrl) {
      await downloadFile(beaconPaths.paramsFile, paramsUrl);
    }
  }
}

export function createBeaconConfig(args: Partial<IBeaconNodeOptions>): Partial<IBeaconNodeOptions> {
  const cliDefaults = _yargs().default(args).options(beaconOptions).parse([]) as Partial<IBeaconNodeOptions>;
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
export function readBeaconConfig(filename: string): RecursivePartial<IBeaconNodeOptions> {
  if (fs.existsSync(filename)) {
    return readFileSync(filename);
  } else {
    return {};
  }
}

/**
 * Reads config files and merges their options with default options and user options
 * @param options
 */
export function mergeBeaconNodeOptions(
  defaultOptions: IBeaconNodeOptions,
  ...optionsArr: RecursivePartial<IBeaconNodeOptions>[]
): IBeaconNodeOptions {
  return (optionsArr as IBeaconNodeOptions[]).reduce((mergedBeaconOptions, options) => {
    return deepmerge(mergedBeaconOptions, options, {arrayMerge});
  }, defaultOptions);
}

export async function initBeaconConfig(filename: string, args: Partial<IBeaconNodeOptions>): Promise<void> {
  await writeBeaconConfig(filename, createBeaconConfig(args));
}

/**
 * If override array option (source) is defined and has items
 * replace target (original option).
 * Example: network.localMultiaddrs has default ['/ip4/127.0.0.1/tcp/30606'] and we don't wanna append to that with cli flag
 * as it could result in port taken
 * @param target
 * @param source
 */
function arrayMerge(target: unknown[], source: unknown[]): unknown[] {
  if (source.length === 0) {
    return target;
  }
  return source;
}
