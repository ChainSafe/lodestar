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

  /** Forks in order order of occurence, `phase0` first */
  forks: {[K in ForkName]: IForkInfo};
  /** Get the hard-fork info for the active fork at `slot` */
  getForkInfo(slot: Slot): IForkInfo;

  /** Get the hard-fork name at a given slot */
  getForkName(slot: Slot): ForkName;
  /** Get the hard-fork version at a given slot */
  getForkVersion(slot: Slot): Version;
  /** Get SSZ types by hard-fork */
  getForkTypes(slot: Slot): AllForksSSZTypes;
}
