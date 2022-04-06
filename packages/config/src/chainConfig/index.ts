import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {IChainConfig} from "./types.js";
import {defaultChainConfig} from "./default.js";

export {chainConfigToJson, chainConfigFromJson} from "./json.js";
export * from "./types.js";
export * from "./default.js";

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
