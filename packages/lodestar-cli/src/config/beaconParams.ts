import {existsSync} from "fs";
import deepmerge from "deepmerge";
import {createIBeaconConfig, IBeaconConfig} from "@chainsafe/lodestar-config";
import {createIBeaconParams, BeaconParams, IBeaconParams} from "@chainsafe/lodestar-params";
import {params as mainnetParams} from "@chainsafe/lodestar-params/lib/presets/mainnet";
import {params as minimalParams} from "@chainsafe/lodestar-params/lib/presets/minimal";
import {writeFile, readFile} from "../util";
import {getTestnetBeaconParams, TestnetName} from "../testnets";

export async function writeBeaconParams(filename: string, params: IBeaconParams): Promise<void> {
  await writeFile(filename, BeaconParams.toJson(params));
}

export async function readBeaconParams(filename: string): Promise<IBeaconParams> {
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

export async function initializeAndWriteBeaconParams({
  paramsFile,
  preset,
  testnet,
  additionalParams,
}: {
  paramsFile: string;
  preset: string;
  testnet?: TestnetName;
  additionalParams?: Record<string, unknown>;
}): Promise<void> {
  // Auto-setup for testnets
  const additionalParamsTestnet = testnet && getTestnetBeaconParams(testnet);

  const config = getBeaconConfig(
    preset,
    deepmerge<Record<string, unknown>>(additionalParamsTestnet || {}, additionalParams || {})
  );
  return await writeBeaconParams(paramsFile, config.params);
}

export async function getMergedIBeaconConfig(
  preset: string,
  paramsFile: string,
  options: Record<string, unknown>
): Promise<IBeaconConfig> {
  return getBeaconConfig(preset, {
    ...(existsSync(paramsFile) ? await readParamsConfig(paramsFile) : {}),
    ...options,
  });
}
