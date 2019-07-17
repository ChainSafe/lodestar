import {IBeaconParams} from "../params";
import {IBeaconSSZTypes} from "@chainsafe/eth2-types";

export interface IBeaconConfig {
  params: IBeaconParams;
  types: IBeaconSSZTypes;
}
