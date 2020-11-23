import {IPhase1SSZTypes} from "../../../types/phase1/interface";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {IBeaconSSZTypes} from "../../interface";
import {Phase1Generator} from "./interface";
import * as primitive from "./primitive";
import * as shard from "./shard";
import * as custody from "./custody";
import * as misc from "./misc";
import * as beacon from "./beacon";

export function createPhase1SSTTypes(params: IBeaconParams, phase0Types: IBeaconSSZTypes): IPhase1SSZTypes {
  const types: Partial<IPhase1SSZTypes> = {};
  phase0Types.phase1 = types as IPhase1SSZTypes;
  let type: keyof IPhase1SSZTypes;
  // primitive types (don't need generators)
  for (type in primitive) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    //@ts-ignore
    // eslint-disable-next-line import/namespace
    types[type] = primitive[type];
    return types as IPhase1SSZTypes;
  }
  for (type in shard) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    //@ts-ignore
    // eslint-disable-next-line import/namespace
    types[type] = (shard[type] as Phase1Generator<unknown>)(params, phase0Types);
  }
  for (type in misc) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    //@ts-ignore
    // eslint-disable-next-line import/namespace
    types[type] = (misc[type] as Phase1Generator<unknown>)(params, phase0Types);
  }
  for (type in custody) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    //@ts-ignore
    // eslint-disable-next-line import/namespace
    types[type] = (custody[type] as Phase1Generator<unknown>)(params, phase0Types);
  }
  for (type in beacon) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    //@ts-ignore
    // eslint-disable-next-line import/namespace
    types[type] = (beacon[type] as Phase1Generator<unknown>)(params, phase0Types);
  }
  return types as IPhase1SSZTypes;
}
