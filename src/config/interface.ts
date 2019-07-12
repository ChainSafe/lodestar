import {BeaconParams} from "../params";
import {BeaconSSZTypes} from "../sszTypes";

export interface IBeaconConfig {
  params: BeaconParams;
  types: BeaconSSZTypes;
}
