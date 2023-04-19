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

/**
 * Parse JSON strings of BeaconPreset
 * - Numbers: Convert quoted decimal string to number
 *
 * Note: extraneous keys are not filtered out and will be validated
 */
export function presetFromJson(json: Record<string, unknown>): Partial<BeaconPreset> {
  const beaconPreset = {} as BeaconPreset;

  for (const key of Object.keys(json) as (keyof BeaconPreset)[]) {
    beaconPreset[key] = deserializePresetValue(json[key], key);
  }

  return beaconPreset;
}

/**
 * Ensure that all values of parsed BeaconPreset are numbers
 * If there are more types, expand this function with a type switch
 */
function deserializePresetValue(valueStr: unknown, keyName: string): number {
  if (typeof valueStr !== "string") {
    throw Error(`Invalid ${keyName} value ${valueStr} expected string`);
  }

  const value = parseInt(valueStr, 10);

  if (isNaN(value)) {
    throw Error(`Invalid ${keyName} value ${valueStr} expected number`);
  }

  return value;
}
