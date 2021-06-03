import {Json} from "@chainsafe/ssz";
import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {IChainConfig} from "./types";
import {ChainConfig} from "./sszTypes";
import {defaultChainConfig} from "./default";

export * from "./types";
export * from "./sszTypes";
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

export function parsePartialIChainConfigJson(input?: Record<string, unknown>): Partial<IChainConfig> {
  if (!input) {
    return {};
  }

  const config = {};

  // Parse config input values, if they exist
  for (const [fieldName, fieldType] of Object.entries(ChainConfig.fields)) {
    if (input[fieldName] != null) {
      (config as Record<string, unknown>)[fieldName] = fieldType.fromJson(input[fieldName] as Json);
    }
  }

  return config;
}
