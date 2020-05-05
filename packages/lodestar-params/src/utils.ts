import {FAILSAFE_SCHEMA, Schema, Type} from "js-yaml";
import {TypeMap, typeMap} from "./types";
import {IBeaconParams} from "./interface";
import * as constants from "./constants";

export function createIBeaconParams(params: Record<string, unknown>): Partial<IBeaconParams> {
  return convertTypes(params, typeMap);
}

export function convertTypes(params: Record<string, unknown>, typeMap: TypeMap<string, unknown>): Partial<IBeaconParams> {
  for(const k in params) {
    if(params.hasOwnProperty(k)) {
      if(typeMap[k]) {
        params[k] = typeMap[k](params[k] as string);
      } else {
        params[k] = Number(params[k]);
      }
    }
  }
  return {
    ...params,
    ...constants
  } as unknown as IBeaconParams;
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
