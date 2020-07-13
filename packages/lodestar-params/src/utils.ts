import {FAILSAFE_SCHEMA, Schema, Type} from "js-yaml";
import {IBeaconParams} from "./interface";
import {Json} from "@chainsafe/ssz";
import {BeaconParams} from './beaconParams';

export function createIBeaconParams(input: Record<string, unknown>): Partial<IBeaconParams> {
  const params: Partial<IBeaconParams> = {};
  Object.entries(BeaconParams.fields).forEach(([fieldName, fieldType]) => {
    if (input[fieldName]) {
      (params as Record<string, unknown>)[fieldName] = fieldType.fromJson(input[fieldName] as Json) as unknown;
    }
  });
  return params;
}

export const schema = new Schema({
  include: [
    FAILSAFE_SCHEMA
  ],
  implicit: [
    new Type("tag:yaml.org,2002:str", {
      kind: "scalar",
      construct: function (data) { return data !== null ? data : ""; }
    })
  ]
});
