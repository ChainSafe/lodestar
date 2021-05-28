import {Json} from "@chainsafe/ssz";
import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {IChainConfig} from "./types";
import {ChainConfig} from "./sszTypes";

export * from "./types";
export * from "./sszTypes";

export function createIChainConfig(input?: Record<string, unknown>): IChainConfig {
  input = input ?? {};
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access
  const presetConfig = require(`../presets/${ACTIVE_PRESET}`).config as IChainConfig;

  // Set the config first with preset values
  const config = {...presetConfig};

  // Override the config with input values, if they exist
  for (const [fieldName, fieldType] of Object.entries(ChainConfig.fields)) {
    if (input[fieldName] != null) {
      (config as Record<string, unknown>)[fieldName] = fieldType.fromJson(input[fieldName] as Json);
    }
  }

  // Assert that the preset matches the active preset
  if (config.PRESET_BASE !== ACTIVE_PRESET) {
    throw new Error(
      `Can only create a config for the active preset: ACTIVE_PRESET=${ACTIVE_PRESET} PRESET_BASE=${config.PRESET_BASE}`
    );
  }
  return config;
}
