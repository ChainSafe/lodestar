import {IBeaconParams} from "@chainsafe/eth2.0-params";
import {createIBeaconSSZTypes} from "@chainsafe/eth2.0-ssz-types";

import {IBeaconConfig} from "./interface";

export * from "./interface";

export function createIBeaconConfig(params: IBeaconParams): IBeaconConfig {
  return {
    params,
    types: createIBeaconSSZTypes(params),
  };
}
