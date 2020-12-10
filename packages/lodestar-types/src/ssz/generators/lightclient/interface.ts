import {IBeaconParams} from "@chainsafe/lodestar-params";
import {ContainerType} from "@chainsafe/ssz";
import {ILightclientSSZTypes} from "../../../types/lightclient/interface";
import {IBeaconSSZTypes} from "../../interface";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LightClientTypesGenerator<T extends ContainerType<any>, R extends keyof ILightclientSSZTypes = never> = (
  params: IBeaconParams,
  phase0Types: Omit<IBeaconSSZTypes, "phase1" | "lightclient">,
  lightclient: Pick<ILightclientSSZTypes, R>
) => T;
