import {TypeMap} from "./types";
import {IBeaconParams} from "./interface";
import {FAILSAFE_SCHEMA, Schema, Type} from "js-yaml";
import * as constants from "./constants";

export function convertTypes(params: Record<string, unknown>, typeMap: TypeMap): IBeaconParams {
  for(const k in params) {
    if(params.hasOwnProperty(k)) {
      if(typeMap[k]) {
        params[k] = typeMap[k](params[k]);
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