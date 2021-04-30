import {IPhase0Params} from "@chainsafe/lodestar-params";
import {IPhase0SSZTypes} from "./interface";
import {getPhase0Types} from "./generator";
import {IPrimitiveSSZTypes} from "../../primitive/IPrimitiveSSZTypes";

export * from "./constants";
export * from "./interface";

export function createIPhase0SSZTypes(params: IPhase0Params, primitive: IPrimitiveSSZTypes): IPhase0SSZTypes {
  const phase0 = getPhase0Types(params, primitive);
  return {...primitive, ...phase0};
}
