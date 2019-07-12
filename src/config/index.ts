import {IBeaconParams} from "../params";
import {IBeaconConfig} from "./interface";
import {createBeaconSSZTypes} from "../sszTypes";

export * from "./interface";

export function createIBeaconConfig(params: IBeaconParams): IBeaconConfig {
  return {
    params,
    types: createBeaconSSZTypes(params),
  };
}
