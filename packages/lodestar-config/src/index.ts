import {IBeaconParams} from "@chainsafe/lodestar-params";
import {createIBeaconSSZTypes, IPhase0SSZTypes, Slot} from "@chainsafe/lodestar-types";

import {IBeaconConfig} from "./interface";

export * from "./interface";

export function createIBeaconConfig(params: IBeaconParams): IBeaconConfig {
  const types = createIBeaconSSZTypes(params);
  return {
    params,
    types,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getTypes(slot: Slot): IPhase0SSZTypes {
      return types.phase0;
    },
  };
}
