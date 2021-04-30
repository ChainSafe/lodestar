import {IBeaconParams} from "@chainsafe/lodestar-params";
import {IPhase0SSZTypes} from "../../phase0";
import {IAltairSSZTypes} from "./interface";
import {getAltairTypes} from "./generator";

export * from "./interface";

export function createIAltairSSZTypes(params: IBeaconParams, phase0: IPhase0SSZTypes): IAltairSSZTypes {
  const altair = getAltairTypes(params, phase0);
  return {...phase0, ...altair};
}
