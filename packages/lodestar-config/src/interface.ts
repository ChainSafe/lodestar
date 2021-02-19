import {IBeaconParams} from "@chainsafe/lodestar-params";
import {IBeaconSSZTypes, IPhase0SSZTypes, Slot} from "@chainsafe/lodestar-types";

export interface IBeaconConfig {
  params: IBeaconParams;
  types: IBeaconSSZTypes;
  /**
   * Get SSZ types by hard-fork
   */
  getTypes(slot: Slot): IPhase0SSZTypes;
}
