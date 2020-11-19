import {Json} from "@chainsafe/ssz";
import {FAILSAFE_SCHEMA, Schema, Type} from "js-yaml";
import {BeaconParams} from "./beaconParams";

export function createParams<T>(input: Record<string, unknown>): T {
  const params: Partial<T> = {};
  Object.entries(BeaconParams.fields).forEach(([fieldName, fieldType]) => {
    if (input[fieldName]) {
      (params as Record<string, unknown>)[fieldName] = fieldType.fromJson(input[fieldName] as Json) as unknown;
    }
  });
  return params as T;
}

export const schema = new Schema({
  include: [FAILSAFE_SCHEMA],
  implicit: [
    new Type("tag:yaml.org,2002:str", {
      kind: "scalar",
      construct: function (data) {
        return data !== null ? data : "";
      },
    }),
  ],
});
