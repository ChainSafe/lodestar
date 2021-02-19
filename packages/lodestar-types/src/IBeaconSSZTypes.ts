import {IBeaconParams} from "@chainsafe/lodestar-params";

import {createIPhase0SSZTypes, IPhase0SSZTypes} from "./phase0";

import {IPrimitiveSSZTypes} from "./primitive/IPrimitiveSSZTypes";
import * as primitive from "./primitive/ssz";

/**
 * SSZ Types used throughout Eth2
 *
 * Simple types are accessible directly.
 *
 * Most types are namespaced by hardfork: `phase0`
 */
export type IBeaconSSZTypes = IPrimitiveSSZTypes & {
  phase0: IPhase0SSZTypes;
};

export function createIBeaconSSZTypes(params: IBeaconParams): IBeaconSSZTypes {
  const phase0 = createIPhase0SSZTypes(params);
  return {
    phase0,
    ...primitive,
  };
}
