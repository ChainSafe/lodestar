/* eslint-disable @typescript-eslint/naming-convention */
import {AllFork, ForkGroup, ForkName, ForkSeq} from "@lodestar/params";
import {allForks, Epoch, Slot, Version} from "@lodestar/types";

export interface IForkInfo {
  name: ForkName;
  seq: ForkSeq;
  epoch: Epoch;
  version: Version;
  prevVersion: Version;
  prevForkName: ForkName;
}

/**
 * Fork schedule and helper methods
 */
export interface IForkConfig {
  /** Forks in order order of occurence, `phase0` first */
  forks: {[K in ForkName]: IForkInfo};
  forksAscendingEpochOrder: IForkInfo[];
  forksDescendingEpochOrder: IForkInfo[];

  /** Get the hard-fork info for the active fork at `slot` */
  getForkInfo(slot: Slot): IForkInfo;

  /** Get the hard-fork name at a given slot */
  getForkName(slot: Slot): ForkName;
  /** Get the hard-fork sequence number at a given slot */
  getForkSeq(slot: Slot): ForkSeq;
  /** Get the hard-fork version at a given slot */
  getForkVersion(slot: Slot): Version;
  /** Get SSZ types by hard-fork */
  getForkTypes<F extends ForkName = AllFork>(slot: Slot): allForks.SSZTypes<F>;
  /** Get SSZ types filtered to a specific a fork group. Attempting to access a fork outside this group results in a thrown error. */
  getForkTypesForGroup<F extends ForkGroup>(slot: Slot, forkGroup: F): allForks.SSZTypes<F[number]>;
}
