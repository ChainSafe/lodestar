/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */
/**
 * @module sszTypes/generators
 */
import {IPhase0Params} from "@chainsafe/lodestar-params";

import * as primitive from "../../../primitive/ssz";
import * as misc from "./misc";
import * as operations from "./operations";
import * as block from "./block";
import * as state from "./state";
import * as validator from "./validator";
import * as wire from "./wire";
import * as api from "./api";

import {IPhase0SSZTypes, phase0TypeNames} from "../interface";
import {IPrimitiveSSZTypes} from "../../../primitive/IPrimitiveSSZTypes";

const allGenerators = {
  ...misc,
  ...operations,
  ...block,
  ...state,
  ...validator,
  ...wire,
  ...api,
};

export function createIPhase0SSZTypes(params: IPhase0Params): IPhase0SSZTypes {
  const types: IPhase0SSZTypes = {} as IPhase0SSZTypes;
  // primitive types (don't need generators)
  for (const type in primitive as IPrimitiveSSZTypes) {
    // @ts-ignore
    // eslint-disable-next-line import/namespace
    types[type] = primitive[type] as IPhase0SSZTypes;
  }
  // relies on list of typenames in dependency order
  for (const type of phase0TypeNames) {
    // @ts-ignore
    types[type] = allGenerators[type](types, params);
  }
  return types;
}
