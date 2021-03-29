import {IBeaconParams} from "@chainsafe/lodestar-params";
import {IPhase1SSZTypes} from "../interface";
import {IAltairSSZTypes} from "../../../altair";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Phase1Generator<T> = (
  params: IBeaconParams,
  altairTypes: IAltairSSZTypes,
  phase1Types: IPhase1SSZTypes
) => T;
