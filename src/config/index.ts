import {IBeaconParams} from "../params";
import {IBeaconConfig} from "./interface";
import {createIBeaconSSZTypes} from "../sszTypes";

export * from "./interface";

export function createIBeaconConfig(params: IBeaconParams): IBeaconConfig {
  return {
    params,
    types: createIBeaconSSZTypes(params),
  };
}
