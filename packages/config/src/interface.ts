import {IBeaconParams} from "@chainsafe/lodestar-params";
import {Epoch, IAllForksSSZTypes, IBeaconSSZTypes, Slot, Version} from "@chainsafe/lodestar-types";

export enum ForkName {
  phase0 = "phase0",
  altair = "altair",
}

export interface IForkInfo {
  name: ForkName;
  epoch: Epoch;
  version: Version;
}

export interface IBeaconConfig {
  params: IBeaconParams;
  types: IBeaconSSZTypes;
  getForkInfoRecord(): Record<ForkName, IForkInfo>;
  /**
   * Get the respective fork and next fork (if exist) given a fork name
   */
  getForkAndNext(forkName: ForkName): {currentFork: IForkInfo; nextFork?: IForkInfo};
  /**
   * Get the hard-fork name at a given slot
   */
  getForkName(slot: Slot): ForkName;
  /**
   * Get the hard-fork version at a given slot
   */
  getForkVersion(slot: Slot): Version;
  /**
   * Get SSZ types by hard-fork
   */
  getTypes(slot: Slot): IAllForksSSZTypes;
}
