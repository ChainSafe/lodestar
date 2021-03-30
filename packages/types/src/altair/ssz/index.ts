/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */
import {IBeaconParams} from "@chainsafe/lodestar-params";

import {IPhase0SSZTypes} from "../../phase0";

import {IAltairSSZTypes} from "./interface";
import * as altairTypes from "./generators";

export * from "./interface";

export function createIAltairSSZTypes(params: IBeaconParams, phase0: IPhase0SSZTypes): IAltairSSZTypes {
  const types: IAltairSSZTypes = ({...phase0} as unknown) as IAltairSSZTypes;
  for (const typeName of Object.keys(altairTypes)) {
    // @ts-ignore
    // eslint-disable-next-line import/namespace
    types[typeName] = altairTypes[typeName](params, phase0, types);
  }
  return types;
}
