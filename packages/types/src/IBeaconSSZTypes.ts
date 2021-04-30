import {IBeaconParams} from "@chainsafe/lodestar-params";

import {createIPhase0SSZTypes, IPhase0SSZTypes} from "./phase0";
import {createIAltairSSZTypes, IAltairSSZTypes} from "./altair";
import {getPrimitiveTypes} from "./primitive/ssz";

import {IPrimitiveSSZTypes} from "./primitive/IPrimitiveSSZTypes";

/**
 * SSZ Types used throughout Eth2
 *
 * Simple types are accessible directly.
 *
 * Most types are namespaced by hardfork: `phase0`, `altair`, `phase1`
 */
export type IBeaconSSZTypes = IPrimitiveSSZTypes & {
  phase0: IPhase0SSZTypes;
  altair: IAltairSSZTypes;
};

export function createIBeaconSSZTypes(params: IBeaconParams): IBeaconSSZTypes {
  const primitive = getPrimitiveTypes();
  const phase0 = createIPhase0SSZTypes(params, primitive);
  const altair = createIAltairSSZTypes(params, phase0);
  return {
    ...primitive,
    phase0,
    altair,
  };
}
