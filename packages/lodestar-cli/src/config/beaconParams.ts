import {createIBeaconConfig, IBeaconConfig} from "@chainsafe/lodestar-config";
import {createIBeaconParams, BeaconParams, IBeaconParams} from "@chainsafe/lodestar-params";
import {params as mainnetParams} from "@chainsafe/lodestar-params/mainnet";
import {params as minimalParams} from "@chainsafe/lodestar-params/minimal";
import {writeFile, readFileIfExists} from "../util";
import {getNetworkBeaconParams, NetworkName} from "../networks";
import {getGlobalPaths, IGlobalPaths} from "../paths/global";
import {IBeaconParamsUnparsed} from "./types";
import {parseBeaconParamsArgs} from "../options";

type IBeaconParamsCliArgs = {
  preset: string;
  network?: NetworkName;
  paramsFile: string;
} & Partial<IGlobalPaths>;

interface IBeaconParamsArgs {
  preset: string;
  network?: NetworkName;
  paramsFile: string;
  additionalParamsCli: IBeaconParamsUnparsed;
}

/**
 * Convenience method to parse yargs CLI args and call getBeaconParams
 * @see getBeaconConfig
 */
export function getBeaconConfigFromArgs(args: IBeaconParamsCliArgs): IBeaconConfig {
  return createIBeaconConfig(getBeaconParamsFromArgs(args));
}

/**
 * Convenience method to parse yargs CLI args and call getBeaconParams
 * @see getBeaconParams
 */
export function getBeaconParamsFromArgs(args: IBeaconParamsCliArgs): IBeaconParams {
  return getBeaconParams({
    preset: args.preset,
    network: args.network,
    paramsFile: getGlobalPaths(args).paramsFile,
    additionalParamsCli: parseBeaconParamsArgs(args as Record<string, string | number>),
  });
}

/**
 * Initializes IBeaconConfig with params
 * @see getBeaconParams
 */
export function getBeaconConfig(args: IBeaconParamsArgs): IBeaconConfig {
  return createIBeaconConfig(getBeaconParams(args));
}

/**
 * Computes merged IBeaconParams type from (in order)
 * - preset
 * - Network params (diff)
 * - existing params file
 * - CLI flags
 */
export function getBeaconParams({preset, network, paramsFile, additionalParamsCli}: IBeaconParamsArgs): IBeaconParams {
  const presetBeaconParams = getPresetBeaconParams(preset);
  const additionalParams = mergeBeaconParams(
    // Default network params
    network ? getNetworkBeaconParams(network) : {},
    // Existing user custom params from file
    readBeaconParamsIfExists(paramsFile),
    // Params from CLI flags
    additionalParamsCli || {}
  );
  return {...presetBeaconParams, ...createIBeaconParams(additionalParams)};
}

function getPresetBeaconParams(preset: string): IBeaconParams {
  switch (preset) {
    case "mainnet":
      return mainnetParams;
    case "minimal":
      return minimalParams;
    default:
      throw Error(`Unsupported spec: ${preset}`);
  }
}

export function writeBeaconParams(filepath: string, params: IBeaconParams): void {
  writeFile(filepath, BeaconParams.toJson(params));
}

function readBeaconParamsIfExists(filepath: string): IBeaconParamsUnparsed {
  return readFileIfExists(filepath) || {};
}

/**
 * Typesafe wrapper to merge partial IBeaconNodeOptions objects
 */
function mergeBeaconParams(...itemsArr: IBeaconParamsUnparsed[]): IBeaconParamsUnparsed {
  return itemsArr.reduce((mergedItems, item) => {
    return {...mergedItems, ...item};
  }, itemsArr[0]);
}
