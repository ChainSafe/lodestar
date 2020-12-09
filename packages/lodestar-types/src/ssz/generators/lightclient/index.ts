import {IBeaconSSZTypes} from "../..";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {ILightClientSSZTypes} from "../../../types/lightclient/interface";

import * as lightclientTypes from "./types";

export function createLightClientTypes(
  params: IBeaconParams,
  phase0Types: Omit<IBeaconSSZTypes, "phase1" | "lightclient">
): ILightClientSSZTypes {
  const types: Partial<ILightClientSSZTypes> = {};
  (Object.entries(lightclientTypes) as [
    keyof typeof lightclientTypes,
    typeof lightclientTypes[keyof typeof lightclientTypes]
  ][]).forEach(([type, generator]) => {
    Object.assign(types, {
      [type]: generator(params, phase0Types, {
        ...(types as ILightClientSSZTypes),
      }),
    });
  });
  return types as ILightClientSSZTypes;
}
