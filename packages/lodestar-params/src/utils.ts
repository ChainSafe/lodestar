import {load, FAILSAFE_SCHEMA, Schema, Type} from "js-yaml";
import {Json, ContainerType} from "@chainsafe/ssz";

export function createParams<T>(input: Record<string, unknown>, type: ContainerType<T>): T {
  const params: Partial<T> = {};
  Object.entries(type.fields).forEach(([fieldName, fieldType]) => {
    if (input[fieldName]) {
      (params as Record<string, unknown>)[fieldName] = fieldType.fromJson(input[fieldName] as Json) as unknown;
    }
  });
  return params as T;
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

export function mapValuesNumToString<T extends {[key: string]: number | string | Array<number | string>}>(
  obj: T
): {[K in keyof T]: string | string[]} {
  const objAsStrings = {} as {[K in keyof T]: string | string[]};
  for (const key in obj) {
    if (Array.isArray(obj[key])) {
      objAsStrings[key] = (obj[key] as Array<string | number>).map((i) => String(i));
    } else {
      objAsStrings[key] = String(obj[key]);
    }
  }
  return objAsStrings;
}
