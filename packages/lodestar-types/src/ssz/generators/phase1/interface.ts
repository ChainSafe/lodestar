import {ContainerType} from "@chainsafe/ssz";
import {IBeaconSSZTypes} from "../../interface";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {IPhase1SSZTypes} from "../../../types/phase1/interface";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Phase1Generator<T extends ContainerType<any>, R extends keyof IPhase1SSZTypes = never> = (
  params: IBeaconParams,
  phase0Types: Omit<IBeaconSSZTypes, "phase1">,
  phase1Types: Pick<IPhase1SSZTypes, R>
) => T;
