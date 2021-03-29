/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {IBeaconParams} from "@chainsafe/lodestar-params";

import {ILightclientSSZTypes} from "../../../altair";
import {IPhase1SSZTypes} from "../interface";

import * as primitive from "./primitive";
import * as misc from "./misc";
import * as shard from "./shard";
import * as custody from "./custody";
import * as beacon from "./beacon";

const allGenerators = {
  ...misc,
  ...shard,
  ...custody,
  ...beacon,
};

export function createIPhase1SSZTypes(params: IBeaconParams, altairTypes: ILightclientSSZTypes): IPhase1SSZTypes {
  const types = ({...altairTypes} as unknown) as IPhase1SSZTypes;

  for (const typeName of Object.keys(primitive)) {
    // @ts-ignore
    // eslint-disable-next-line import/namespace
    types[typeName] = primitive[typeName];
  }

  for (const [typeName, generator] of Object.entries(allGenerators)) {
    // @ts-ignore
    types[typeName] = generator(params, altairTypes, types);
  }

  return types;
}
