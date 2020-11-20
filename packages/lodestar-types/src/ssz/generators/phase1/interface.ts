import {ContainerType} from "@chainsafe/ssz";
import {IBeaconSSZTypes} from "../../interface";
import {IBeaconParams} from "@chainsafe/lodestar-params";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Phase1Generator<T extends ContainerType<any>> = (params: IBeaconParams, sszTypes: IBeaconSSZTypes) => T;
