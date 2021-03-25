import {IBeaconParams} from "@chainsafe/lodestar-params";
import {IPhase1SSZTypes} from "../interface";
import {ILightclientSSZTypes} from "../../../lightclient";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Phase1Generator<T> = (
  params: IBeaconParams,
  lightclientTypes: ILightclientSSZTypes,
  phase1Types: IPhase1SSZTypes
) => T;
