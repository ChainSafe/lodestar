import {ACTIVE_PRESET} from "@lodestar/params";
import {defaultChainConfig} from "./default.js";
import {ChainConfig} from "./types.js";

export * from "./default.js";
export {chainConfigFromJson, chainConfigToJson, deserializeBlobSchedule, specValuesToJson} from "./json.js";
export * from "./types.js";

/**
 * Create an `ChainConfig`, filling in missing values with preset defaults
 */
export function createChainConfig(input: Partial<ChainConfig>): ChainConfig {
  const config = {
    // Set the config first with default preset values
    ...defaultChainConfig,
    // Override with input
    ...input,
  };

  // Set SLOT_DURATION_MS if SECONDS_PER_SLOT is provided but SLOT_DURATION_MS is not.
  // This is to provide backward compatibility until Gloas is live
  if (input.SLOT_DURATION_MS === undefined) {
    config.SLOT_DURATION_MS = config.SECONDS_PER_SLOT * 1000;
  }

  // Assert that the preset matches the active preset
  if (config.PRESET_BASE !== ACTIVE_PRESET) {
    throw new Error(
      `Can only create a config for the active preset: ACTIVE_PRESET=${ACTIVE_PRESET} PRESET_BASE=${config.PRESET_BASE}`
    );
  }
  return config;
}
