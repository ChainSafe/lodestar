import {createIBeaconConfig, IBeaconConfig} from "@chainsafe/lodestar-config";
import {createIBeaconParams, BeaconParams, IBeaconParams} from "@chainsafe/lodestar-params";
import {params as mainnetParams} from "@chainsafe/lodestar-params/lib/presets/mainnet";
import {params as minimalParams} from "@chainsafe/lodestar-params/lib/presets/minimal";
import {writeFile, readFileIfExists} from "../util";
import {getTestnetBeaconParams, TestnetName} from "../testnets";
import {IBeaconParamsUnparsed} from "./types";

interface IBeaconParamsArgs {
  preset: string;
  testnet?: TestnetName;
  paramsFile: string;
  additionalParamsCli?: IBeaconParamsUnparsed;
}

/**
 * Initializes IBeaconConfig with params from (in order)
 * - preset
 * - Testnet params (diff)
 * - existing params file
 * - CLI flags
 */
export function getBeaconConfig(kwargs: IBeaconParamsArgs): IBeaconConfig {
  return createIBeaconConfig(getBeaconParams(kwargs));
}

/**
 * Computes merged IBeaconParams type from (in order)
 * - preset
 * - Testnet params (diff)
 * - existing params file
 * - CLI flags
 */
export function getBeaconParams({preset, testnet, paramsFile, additionalParamsCli}: IBeaconParamsArgs): IBeaconParams {
  const presetBeaconParams = getPresetBeaconParams(preset);
  const additionalParams = mergeBeaconParams(
    // Default testnet params
    testnet ? getTestnetBeaconParams(testnet) : {},
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
