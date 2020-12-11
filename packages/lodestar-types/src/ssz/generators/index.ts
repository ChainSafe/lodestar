/**
 * @module sszTypes/generators
 */
import {IBeaconParams} from "@chainsafe/lodestar-params";

import * as primitive from "./primitive";
import * as misc from "./misc";
import * as operations from "./operations";
import * as block from "./block";
import * as state from "./state";
import * as validator from "./validator";
import * as wire from "./wire";
import * as api from "./api";

import {IBeaconSSZTypes, typeNames} from "../interface";

const allGenerators = {
  ...misc,
  ...operations,
  ...block,
  ...state,
  ...validator,
  ...wire,
  ...api,
};

export function createIBeaconSSZTypes(params: IBeaconParams): IBeaconSSZTypes {
  const types: IBeaconSSZTypes = {} as IBeaconSSZTypes;
  // primitive types (don't need generators)
  for (const type in primitive) {
    // @ts-ignore
    // eslint-disable-next-line import/namespace
    types[type] = primitive[type];
  }
  // relies on list of typenames in dependency order
  typeNames.forEach((type) => {
    // @ts-ignore
    types[type] = allGenerators[type](types, params);
  });
  return types;
}
