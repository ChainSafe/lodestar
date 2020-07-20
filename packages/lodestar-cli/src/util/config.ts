import {createIBeaconConfig, IBeaconConfig} from "@chainsafe/lodestar-config";
import {params as mainnetParams} from "@chainsafe/lodestar-params/lib/presets/mainnet";
import {params as minimalParams} from "@chainsafe/lodestar-params/lib/presets/minimal";

export function getBeaconConfig(spec: string): IBeaconConfig {
  switch (spec) {
    case "mainnet":
      return createIBeaconConfig(mainnetParams);
    case "minimal":
      return createIBeaconConfig(minimalParams);
    default:
      throw Error(`Unsupported spec: ${spec}`);
  }
}
