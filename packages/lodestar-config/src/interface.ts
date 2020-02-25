import {IBeaconParams} from "@chainsafe/lodestar-params";
import {IBeaconSSZTypes} from "@chainsafe/lodestar-types";

export interface IBeaconConfig {
  params: IBeaconParams;
  types: IBeaconSSZTypes;
}
