import {ForkAll, ForkName, ForkPostAltair, ForkPostBellatrix, ForkPostDeneb, ForkSeq} from "@lodestar/params";
import {Epoch, SSZTypesFor, Slot, Version} from "@lodestar/types";
import {BlobScheduleEntry} from "../chainConfig/types.js";
import {SubscribeBoundary} from "../genesisConfig/types.js";

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
  forkOrBlobScheduleAscendingEpochOrder: (ForkInfo | BlobScheduleEntry)[];

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
  /** Get post-altair SSZ types by hard-fork*/
  getPostAltairForkTypes(slot: Slot): SSZTypesFor<ForkPostAltair>;
  /** Get post-bellatrix SSZ types by hard-fork*/
  getPostBellatrixForkTypes(slot: Slot): SSZTypesFor<ForkPostBellatrix>;
  /** Get post-deneb SSZ types by hard-fork*/
  getPostDenebForkTypes(slot: Slot): SSZTypesFor<ForkPostDeneb>;
  /** Get max blobs per block at a given epoch */
  getMaxBlobsPerBlock(epoch: Epoch): number;
  /** Get blob schedule entry at a given epoch */
  getBlobParameters(epoch: Epoch): BlobScheduleEntry;
  /** Get subscribe boundary at a given epoch */
  getSubscribeBoundary(epoch: Epoch): SubscribeBoundary;
  /** Get max request blob sidecars by hard-fork */
  getMaxRequestBlobSidecars(fork: ForkName): number;
};

export function isBlobSchedule(
  forkOrBlobSchedule: ForkConfig["forkOrBlobScheduleAscendingEpochOrder"][number]
): forkOrBlobSchedule is BlobScheduleEntry {
  return "EPOCH" in forkOrBlobSchedule;
}
