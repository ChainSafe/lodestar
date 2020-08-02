import {existsSync} from "fs";
import {createIBeaconConfig, IBeaconConfig} from "@chainsafe/lodestar-config";
import {createIBeaconParams, BeaconParams} from "@chainsafe/lodestar-params";
import {params as mainnetParams} from "@chainsafe/lodestar-params/lib/presets/mainnet";
import {params as minimalParams} from "@chainsafe/lodestar-params/lib/presets/minimal";


import {writeFile, readFile} from "../util";

export async function writeParamsConfig(filename: string, config: IBeaconConfig): Promise<void> {
  await writeFile(filename, BeaconParams.toJson(config.params));
}

export async function readParamsConfig(filename: string): Promise<Record<string, unknown>> {
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
