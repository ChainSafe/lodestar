import {IBeaconParams} from "@chainsafe/lodestar-params";
import {getPrimitiveTypes, PrimitiveSSZTypes} from "./primitive";
import {getPhase0Types, Phase0SSZTypes} from "./phase0";
import {getAltairTypes, AltairSSZTypes} from "./altair";

export * from "./primitive/types";

export * from "./phase0/sszTypes";
export * as phase0 from "./phase0";

export * from "./altair/sszTypes";
export * as altair from "./altair";

// Export union types
export * as allForks from "./allForks";
export {AllForksSSZTypes} from "./allForks";

/**
 * SSZ Types used throughout Eth2
 *
 * Simple types are accessible directly.
 *
 * Most types are namespaced by hardfork: `phase0`, `altair`, `phase1`
 */
export type IBeaconSSZTypes = PrimitiveSSZTypes & {
  phase0: PrimitiveSSZTypes & Phase0SSZTypes;
  altair: PrimitiveSSZTypes &
    Omit<Phase0SSZTypes, "BeaconBlockBody" | "BeaconBlock" | "SignedBeaconBlock" | "BeaconState"> &
    AltairSSZTypes;
};

export function createIBeaconSSZTypes(params: IBeaconParams): IBeaconSSZTypes {
  const primitive = getPrimitiveTypes();
  const phase0 = getPhase0Types(params, primitive);
  const altair = getAltairTypes(params, {...primitive, ...phase0});
  return {
    ...primitive,
    phase0: {...primitive, ...phase0},
    altair: {...primitive, ...phase0, ...altair},
  };
}
