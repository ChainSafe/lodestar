import {IBeaconParams} from "@chainsafe/lodestar-params";
import {createIBeaconSSZTypes} from "@chainsafe/lodestar-types";

import {IBeaconConfig} from "./interface";

export * from "./interface";

export function createIBeaconConfig(params: IBeaconParams): IBeaconConfig {
  return {
    params,
    types: createIBeaconSSZTypes(params),
  };
}
