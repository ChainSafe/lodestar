import {IBeaconParams} from "../params";
import {IBeaconSSZTypes} from "../sszTypes";

export interface IBeaconConfig {
  params: IBeaconParams;
  types: IBeaconSSZTypes;
}
