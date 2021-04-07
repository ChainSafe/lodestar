import {IBeaconParams} from "@chainsafe/lodestar-params";
import {IAllForksSSZTypes, IBeaconSSZTypes, Slot, Version} from "@chainsafe/lodestar-types";

export type IForkName = "phase0" | "altair";

export interface IForkInfo {
  name: IForkName;
  slot: Slot;
  version: Version;
}

export interface IBeaconConfig {
  params: IBeaconParams;
  types: IBeaconSSZTypes;
  getForkInfoRecord(): Record<IForkName, IForkInfo>;
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
  getTypes(slot: Slot): IAllForksSSZTypes;
}
