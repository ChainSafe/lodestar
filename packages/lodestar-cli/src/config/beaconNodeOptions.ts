import fs from "fs";
import _yargs from "yargs/yargs";
import deepmerge from "deepmerge";
import {Json} from "@chainsafe/ssz";
import defaultOptions, {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {readFile, writeFile, RecursivePartial} from "../util";
import {fetchBootnodes, getTestnetBeaconNodeOptions, TestnetName} from "../testnets";

export class BeaconNodeOptions {
  private beaconNodeOptions: RecursivePartial<IBeaconNodeOptions>;

  constructor({
    beaconNodeArgs,
    configFile,
    testnet,
  }: {
    beaconNodeArgs: RecursivePartial<IBeaconNodeOptions>;
    configFile?: string;
    testnet?: TestnetName;
  }) {
    this.beaconNodeOptions = mergeBeaconNodeOptions(
      testnet ? getTestnetBeaconNodeOptions(testnet) : {},
      configFile ? readBeaconNodeOptions(configFile) : {},
      beaconNodeArgs
    );
  }

  get(): RecursivePartial<IBeaconNodeOptions> {
    return this.beaconNodeOptions;
  }

  getWithDefaults(): IBeaconNodeOptions {
    return mergeBeaconNodeOptionsWithDefaults(defaultOptions, this.beaconNodeOptions);
  }

  set(beaconNodeOptionsPartial: RecursivePartial<IBeaconNodeOptions>): void {
    this.beaconNodeOptions = deepmerge(this.beaconNodeOptions, beaconNodeOptionsPartial as IBeaconNodeOptions);
  }

  writeTo(filepath: string): void {
    writeFile(filepath, this.beaconNodeOptions as Json);
  }
}

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
  return mergeBeaconNodeOptionsWithDefaults(
    // All required properties are defined
    defaultOptions,
    // Required properties may not be defined
    testnet ? getTestnetBeaconNodeOptions(testnet) : {},
    configFile ? readBeaconNodeOptions(configFile) : {},
    beaconNodeArgs
  );
}

export async function fetchTestnetBootnodesAsBeaconNodeOptions(
  testnet?: TestnetName
): Promise<RecursivePartial<IBeaconNodeOptions>> {
  if (testnet) {
    try {
      return {
        network: {
          discv5: {
            bootEnrs: await fetchBootnodes(testnet),
          },
        },
      };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Error fetching latest bootnodes: ${e.stack}`);
    }
  }
  return {};
}

export function writeBeaconNodeOptions(filename: string, config: Partial<IBeaconNodeOptions>): void {
  writeFile(filename, config as Json);
}

/**
 * This needs to be a synchronous function because it will be run as part of the yargs 'build' step
 * If the config file is not found, the default values will apply.
 */
export function readBeaconNodeOptions(filename: string): RecursivePartial<IBeaconNodeOptions> {
  if (fs.existsSync(filename)) {
    return readFile(filename);
  } else {
    return {};
  }
}

/**
 * Typesafe wrapper to merge partial IBeaconNodeOptions objects
 */
export function mergeBeaconNodeOptions(
  ...partialOptionsArr: RecursivePartial<IBeaconNodeOptions>[]
): RecursivePartial<IBeaconNodeOptions> {
  return partialOptionsArr.reduce((mergedBeaconOptions, options) => {
    return deepmerge(mergedBeaconOptions, options, {arrayMerge});
  }, partialOptionsArr[0]);
}

/**
 * Typesafe wrapper to merge IBeaconNodeOptions objects
 */
export function mergeBeaconNodeOptionsWithDefaults(
  defaultOptions: IBeaconNodeOptions,
  ...partialOptionsArr: RecursivePartial<IBeaconNodeOptions>[]
): IBeaconNodeOptions {
  return (partialOptionsArr as IBeaconNodeOptions[]).reduce((mergedBeaconOptions, options) => {
    return deepmerge(mergedBeaconOptions, options, {arrayMerge});
  }, defaultOptions);
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
