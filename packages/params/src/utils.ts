import {Json} from "@chainsafe/ssz";

import {IBeaconPreset, BeaconPreset} from "./preset";

export function createIBeaconPreset(input: Record<string, unknown>): Partial<IBeaconPreset> {
  const params: Partial<IBeaconPreset> = {};
  for (const [fieldName, fieldType] of Object.entries(BeaconPreset.fields)) {
    if (input[fieldName] != null) {
      try {
        (params as Record<string, unknown>)[fieldName] = fieldType.fromJson(input[fieldName] as Json) as unknown;
      } catch (e) {
        (e as Error).message = `Error parsing '${fieldName}': ${(e as Error).message}`;
        throw e;
      }
    }
  }
  return params;
}
