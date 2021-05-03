import {IBeaconParams} from "@chainsafe/lodestar-params";
import {Epoch, AllForksSSZTypes, IBeaconSSZTypes, Slot, Version} from "@chainsafe/lodestar-types";

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

  forks: {[K in ForkName]: IForkInfo};
  getForkInfo(slot: Slot): IForkInfo;
  /** Get the hard-fork name at a given slot */
  getForkName(slot: Slot): ForkName;
  /** Get the hard-fork version at a given slot */
  getForkVersion(slot: Slot): Version;
  /** Get SSZ types by hard-fork */
  getTypes(slot: Slot): AllForksSSZTypes;
}
