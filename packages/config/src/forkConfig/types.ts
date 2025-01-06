import {ForkAll, ForkBlobs, ForkExecution, ForkLightClient, ForkName, ForkSeq} from "@lodestar/params";
import {Epoch, SSZTypesFor, Slot, Version} from "@lodestar/types";

export type ForkInfo = {
  name: ForkName;
  seq: ForkSeq;
  epoch: Epoch;
  version: Version;
  prevVersion: Version;
  prevForkName: ForkName;
};

/**
 * Fork schedule and helper methods
 */
export type ForkConfig = {
  /** Forks in order order of occurence, `phase0` first */
  forks: {[K in ForkName]: ForkInfo};
  forksAscendingEpochOrder: ForkInfo[];
  forksDescendingEpochOrder: ForkInfo[];

  /** Get the hard-fork info for the active fork at `slot` */
  getForkInfo(slot: Slot): ForkInfo;
  /** Get the hard-fork info for the active fork at `epoch` */
  getForkInfoAtEpoch(epoch: Epoch): ForkInfo;
  /** Get the hard-fork name at a given slot */
  getForkName(slot: Slot): ForkName;
  /** Get the hard-fork sequence number at a given slot */
  getForkSeq(slot: Slot): ForkSeq;
  /** Get the hard-fork sequence number at a given epoch */
  getForkSeqAtEpoch(epoch: Epoch): ForkSeq;
  /** Get the hard-fork version at a given slot */
  getForkVersion(slot: Slot): Version;
  /** Get SSZ types by hard-fork */
  getForkTypes<F extends ForkName = ForkAll>(slot: Slot): SSZTypesFor<F>;
  /** Get lightclient SSZ types by hard-fork*/
  getLightClientForkTypes(slot: Slot): SSZTypesFor<ForkLightClient>;
  /** Get execution SSZ types by hard-fork*/
  getExecutionForkTypes(slot: Slot): SSZTypesFor<ForkExecution>;
  /** Get blobs SSZ types by hard-fork*/
  getBlobsForkTypes(slot: Slot): SSZTypesFor<ForkBlobs>;
  /** Get max blobs per block by hard-fork */
  getMaxBlobsPerBlock(fork: ForkName): number;
};
