/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */
import {IBeaconParams} from "@chainsafe/lodestar-params";

import {IPhase0SSZTypes} from "../../phase0";

import {ILightclientSSZTypes} from "./interface";
import * as lightclientTypes from "./generators";

export * from "./interface";

export function createILightclientSSZTypes(params: IBeaconParams, phase0: IPhase0SSZTypes): ILightclientSSZTypes {
  const types: ILightclientSSZTypes = ({...phase0} as unknown) as ILightclientSSZTypes;
  for (const typeName of Object.keys(lightclientTypes)) {
    // @ts-ignore
    // eslint-disable-next-line import/namespace
    types[typeName] = lightclientTypes[typeName](params, phase0, types);
  }
  return types;
}
