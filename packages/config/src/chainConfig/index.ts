import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {IChainConfig} from "./types";
import {defaultChainConfig} from "./default";

export {chainConfigToJson, chainConfigFromJson} from "./json";
export * from "./types";
export * from "./default";

/**
 * Create an `IChainConfig`, filling in missing values with preset defaults
 */
export function createIChainConfig(input: Partial<IChainConfig>): IChainConfig {
  const config = {
    // Set the config first with default preset values
    ...defaultChainConfig,
    // Override with input
    ...input,
  };

  // Assert that the preset matches the active preset
  if (config.PRESET_BASE !== ACTIVE_PRESET) {
    throw new Error(
      `Can only create a config for the active preset: ACTIVE_PRESET=${ACTIVE_PRESET} PRESET_BASE=${config.PRESET_BASE}`
    );
  }
  return config;
}
