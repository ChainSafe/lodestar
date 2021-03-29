import {IBeaconParams} from "@chainsafe/lodestar-params";

import {createIPhase0SSZTypes, IPhase0SSZTypes} from "./phase0";
import {createILightclientSSZTypes, ILightclientSSZTypes} from "./altair";
import {createIPhase1SSZTypes, IPhase1SSZTypes} from "./phase1";

import {IPrimitiveSSZTypes} from "./primitive/IPrimitiveSSZTypes";
import * as primitive from "./primitive/ssz";

/**
 * SSZ Types used throughout Eth2
 *
 * Simple types are accessible directly.
 *
 * Most types are namespaced by hardfork: `phase0`, `altair`, `phase1`
 */
export type IBeaconSSZTypes = IPrimitiveSSZTypes & {
  phase0: IPhase0SSZTypes;
  altair: ILightclientSSZTypes;
  phase1: IPhase1SSZTypes;
};

export function createIBeaconSSZTypes(params: IBeaconParams): IBeaconSSZTypes {
  const phase0 = createIPhase0SSZTypes(params);
  const altair = createILightclientSSZTypes(params, phase0);
  const phase1 = createIPhase1SSZTypes(params, altair);
  return {
    phase0,
    altair,
    phase1,
    ...primitive,
  };
}
