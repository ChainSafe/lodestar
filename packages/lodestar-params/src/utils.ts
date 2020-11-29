import {load, FAILSAFE_SCHEMA, Schema, Type} from "js-yaml";
import {IBeaconParams} from "./interface";
import {Json} from "@chainsafe/ssz";
import {BeaconParams} from "./beaconParams";

export function createIBeaconParams(input: Record<string, unknown>): Partial<IBeaconParams> {
  const params: Partial<IBeaconParams> = {};
  Object.entries(BeaconParams.fields).forEach(([fieldName, fieldType]) => {
    if (input[fieldName]) {
      (params as Record<string, unknown>)[fieldName] = fieldType.fromJson(input[fieldName] as Json) as unknown;
    }
  });
  return params;
}

export function loadConfigYaml(configYaml: string): Record<string, unknown> {
  return load(configYaml, {schema});
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

export function mapValuesNumToString<T extends {[key: string]: number | string}>(obj: T): {[K in keyof T]: string} {
  const objAsStrings = {} as {[K in keyof T]: string};
  for (const key in obj) {
    objAsStrings[key] = String(obj[key]);
  }
  return objAsStrings;
}
