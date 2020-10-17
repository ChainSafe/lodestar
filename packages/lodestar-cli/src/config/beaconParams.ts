import deepmerge from "deepmerge";
import {createIBeaconConfig, IBeaconConfig} from "@chainsafe/lodestar-config";
import {createIBeaconParams, BeaconParams, IBeaconParams} from "@chainsafe/lodestar-params";
import {params as mainnetParams} from "@chainsafe/lodestar-params/lib/presets/mainnet";
import {params as minimalParams} from "@chainsafe/lodestar-params/lib/presets/minimal";
import {writeFile, readFile} from "../util";
import {getTestnetBeaconParams, TestnetName} from "../testnets";

interface IBeaconParamsArgs {
  paramsFile: string;
  preset: string;
  testnet?: TestnetName;
  additionalParamsCli?: Record<string, unknown>;
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

export function writeBeaconParams(filename: string, params: IBeaconParams): void {
  writeFile(filename, BeaconParams.toJson(params));
}

function readBeaconParamsIfExists(filename: string): Partial<IBeaconParams> {
  try {
    return readFile(filename);
  } catch (e) {
    if (e.code === "ENOENT") {
      return {};
    } else {
      throw e;
    }
  }
}

/**
 * Typesafe wrapper to merge partial IBeaconNodeOptions objects
 */
function mergeBeaconParams(...itemsArr: Partial<IBeaconParams>[]): Partial<IBeaconParams> {
  return itemsArr.reduce((mergedItems, item) => {
    return deepmerge(mergedItems, item);
  }, itemsArr[0]);
}
