import {load, FAILSAFE_SCHEMA, Schema, Type} from "js-yaml";
import {Json} from "@chainsafe/ssz";

import {IBeaconParams} from "./interface";
import {BeaconParams} from "./beaconParams";

export function createIBeaconParams(input: Record<string, unknown>): Partial<IBeaconParams> {
  const params: Partial<IBeaconParams> = {};
  for (const [fieldName, fieldType] of Object.entries(BeaconParams.fields)) {
    if (input[fieldName] != null) {
      (params as Record<string, unknown>)[fieldName] = fieldType.fromJson(input[fieldName] as Json) as unknown;
    }
  }
  return params;
}

export function loadConfigYaml(configYaml: string): Record<string, unknown> {
  return load(configYaml, {schema}) as Record<string, unknown>;
}

export const schema = new Schema({
  include: [FAILSAFE_SCHEMA],
  implicit: [
    new Type("tag:yaml.org,2002:str", {
      kind: "scalar",
      construct: function (data) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return data !== null ? data : "";
      },
    }),
  ],
});
