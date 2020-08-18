import {createIBeaconConfig, IBeaconConfig} from "@chainsafe/lodestar-config";
import {createIBeaconParams} from "@chainsafe/lodestar-params";
import {params as mainnetParams} from "@chainsafe/lodestar-params/lib/presets/mainnet";
import {params as minimalParams} from "@chainsafe/lodestar-params/lib/presets/minimal";

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
