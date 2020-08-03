import {existsSync} from "fs";
import {createIBeaconConfig, IBeaconConfig} from "@chainsafe/lodestar-config";
import {createIBeaconParams, BeaconParams, IBeaconParams} from "@chainsafe/lodestar-params";
import {params as mainnetParams} from "@chainsafe/lodestar-params/lib/presets/mainnet";
import {params as minimalParams} from "@chainsafe/lodestar-params/lib/presets/minimal";


import {writeFile, readFile} from "../util";

export async function writeParamsConfig(filename: string, config: IBeaconConfig): Promise<void> {
  await writeParams(filename, config.params);
}

export async function writeParams(filename: string, params: IBeaconParams): Promise<void> {
  await writeFile(filename, BeaconParams.toJson(params));
}

export async function readParamsConfig(filename: string): Promise<IBeaconParams> {
  return await readFile(filename);
}

export function getBeaconConfig(preset: string, additionalParams: Record<string, unknown> = {}): IBeaconConfig {
  switch (preset) {
    case "mainnet":
      return createIBeaconConfig({...mainnetParams, ...createIBeaconParams(additionalParams)});
    case "minimal":
      return createIBeaconConfig({...minimalParams, ...createIBeaconParams(additionalParams)});
    default:
      throw Error(`Unsupported spec: ${preset}`);
  }
}

export async function getMergedIBeaconConfig(
  preset: string, paramsFile: string, options: Record<string, unknown>,
): Promise<IBeaconConfig> {
  return getBeaconConfig(preset, {
    ...(existsSync(paramsFile) ? (await readParamsConfig(paramsFile)) : {}),
    ...options,
  });
}

/**
 * Adds required params not found in the downloaded config
 */
export async function appendTestnetParamsConfig(filename: string): Promise<void> {
  const params = await readParamsConfig(filename);
  if (params.DEPOSIT_CHAIN_ID === undefined) params.DEPOSIT_CHAIN_ID = 5;
  if (params.DEPOSIT_NETWORK_ID === undefined) params.DEPOSIT_NETWORK_ID = 5;
  await writeParams(filename, params as IBeaconParams);
}
