/**
 * @module sszTypes/generators
 */
import * as primitive from "./primitive";
import * as misc from "./misc";
import * as operations from "./operations";
import * as block from "./block";
import * as state from "./state";
import * as validator from "./validator";
import * as wire from "./wire";

import {IBeaconParams} from "../../params";
import {BeaconSSZTypes, typeNames} from "../interface";

const allGenerators = {
  ...misc,
  ...operations,
  ...block,
  ...state,
  ...validator,
  ...wire,
}

export function createBeaconSSZTypes(params: IBeaconParams): BeaconSSZTypes {
  // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
  const types: BeaconSSZTypes = {} as BeaconSSZTypes;
  // primitive types (don't need generators)
  for (const type in primitive) {
    types[type] = primitive[type];
  }
  // relies on list of typenames in dependency order
  typeNames.forEach((type) => {
    types[type] = allGenerators[type](types, params);
  });
  /* or if we can separate out types w/ dependencies into files
  for (const type in misc) {
    types[type] = misc[type](types, params);
  }
  for (const type in operations) {
    types[type] = operations[type](types, params);
  }
  for (const type in block) {
    types[type] = block[type](types, params);
  }
  for (const type in state) {
    types[type] = state[type](types, params);
  }
  for (const type in validator) {
    types[type] = validator[type](types, params);
  }
  for (const type in wire) {
    types[type] = wire[type](types, params);
  }
   */
  return types;
}
