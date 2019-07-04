import {BeaconParams} from "../params";
import {BeaconSSZTypes} from "../sszTypes";

export interface BeaconConfig {
  params: BeaconParams;
  types: BeaconSSZTypes;
}
