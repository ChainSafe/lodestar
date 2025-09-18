import {ForkAll, ForkName, ForkPostAltair, ForkPostBellatrix, ForkPostDeneb, ForkSeq} from "@lodestar/params";
import {Epoch, SSZTypesFor, Slot, UintNum64, Version} from "@lodestar/types";

export type ForkInfo = {
  name: ForkName;
  seq: ForkSeq;
  epoch: Epoch;
  version: Version;
  prevVersion: Version;
  prevForkName: ForkName;
};

/**
 * Fork boundaries include both normal hard-forks (phase0, altair, etc.)
 * and Blob Parameter Only (BPO) forks and are used to un-/subscribe to gossip topics
 * and compute the fork digest primarily for domain separation on the p2p layer.
 */
export type ForkBoundary = {fork: ForkName; epoch: Epoch};

export type BlobParameters = {epoch: Epoch; maxBlobsPerBlock: UintNum64};

/**
 * Fork schedule and helper methods
 */
export type ForkConfig = {
  /** Forks in order order of occurence, `phase0` first */
  forks: {[K in ForkName]: ForkInfo};
  forksAscendingEpochOrder: ForkInfo[];
  forksDescendingEpochOrder: ForkInfo[];
  forkBoundariesAscendingEpochOrder: ForkBoundary[];
  forkBoundariesDescendingEpochOrder: ForkBoundary[];

  /** Get the hard-fork info for the active fork at `slot` */
  getForkInfo(slot: Slot): ForkInfo;
  /** Get the hard-fork info for the active fork at `epoch` */
  getForkInfoAtEpoch(epoch: Epoch): ForkInfo;
  /** Get the active fork boundary at a given `epoch` */
  getForkBoundaryAtEpoch(epoch: Epoch): ForkBoundary;
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
  /** Get blob parameters at a given epoch */
  getBlobParameters(epoch: Epoch): BlobParameters;
};
