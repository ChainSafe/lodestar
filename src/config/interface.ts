import {IBeaconParams} from "../params";
import {BeaconSSZTypes} from "../sszTypes";

export interface IBeaconConfig {
  params: IBeaconParams;
  types: BeaconSSZTypes;
}
