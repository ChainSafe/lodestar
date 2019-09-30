import {IBeaconParams} from "@chainsafe/eth2.0-params";
import {IBeaconSSZTypes} from "@chainsafe/eth2.0-types";

export interface IBeaconConfig {
  params: IBeaconParams;
  types: IBeaconSSZTypes;
}
