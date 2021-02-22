import {IBeaconParams} from "@chainsafe/lodestar-params";
import {
  IBeaconSSZTypes,
  ILightclientSSZTypes,
  IPhase0SSZTypes,
  IPhase1SSZTypes,
  Slot,
  Version,
} from "@chainsafe/lodestar-types";

export type IForkName = "phase0" | "lightclient" | "phase1";

export interface IBeaconConfig {
  params: IBeaconParams;
  types: IBeaconSSZTypes;
  /**
   * Get the hard-fork name at a given slot
   */
  getForkName(slot: Slot): IForkName;
  /**
   * Get the hard-fork version at a given slot
   */
  getForkVersion(slot: Slot): Version;
  /**
   * Get SSZ types by hard-fork
   */
  getTypes(slot: Slot): IPhase0SSZTypes | ILightclientSSZTypes | IPhase1SSZTypes;
}
