import {BeaconParams} from "../params";
import {BeaconConfig} from "./interface";
import {createBeaconSSZTypes} from "../sszTypes";

export * from "./interface";

export function createBeaconConfig(params: BeaconParams): BeaconConfig {
  return {
    params,
    types: createBeaconSSZTypes(params),
  };
}
