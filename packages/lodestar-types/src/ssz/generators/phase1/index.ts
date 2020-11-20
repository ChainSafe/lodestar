import {IPhase1SSZTypes} from "../../../types/phase1/interface";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {IBeaconSSZTypes} from "../../interface";

import * as primitive from "./primitive";
import * as shard from "./shard";
import {Phase1Generator} from "./interface";

export function createPhase1SSTTypes(params: IBeaconParams, phase0Types: IBeaconSSZTypes): IPhase1SSZTypes {
  const types: Partial<IPhase1SSZTypes> = {};
  phase0Types.phase1 = types as IPhase1SSZTypes;
  let type: keyof IPhase1SSZTypes;
  // primitive types (don't need generators)
  for (type in primitive) {
    //@ts-ignore
    // eslint-disable-next-line import/namespace
    types[type] = primitive[type];
    return types as IPhase1SSZTypes;
  }
  for (type in shard) {
    //@ts-ignore
    // eslint-disable-next-line import/namespace
    types[type] = (shard[type] as Phase1Generator<unknown>)(params, phase0Types);
  }
  return types as IPhase1SSZTypes;
}
