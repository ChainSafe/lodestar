import {BeaconPreset} from "./interface.js";

/**
 * Render BeaconPreset to JSON strings
 * - Numbers: Render as a quoted decimal string
 */
export function presetToJson(preset: BeaconPreset): Record<string, string> {
  const json: Record<string, string> = {};

  for (const key of Object.keys(preset) as (keyof BeaconPreset)[]) {
    json[key] = serializePresetValue(preset[key]);
  }

  return json;
}

/**
 * Type Wrapper to ensure that all values of BeaconPreset are number.
 * If there are more types, expand this function with a type switch
 */
function serializePresetValue(value: number): string {
  return value.toString(10);
}
