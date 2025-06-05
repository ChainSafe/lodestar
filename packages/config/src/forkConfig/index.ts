import {
  ForkAll,
  ForkName,
  ForkPostAltair,
  ForkPostBellatrix,
  ForkPostDeneb,
  ForkSeq,
  GENESIS_EPOCH,
  SLOTS_PER_EPOCH,
  isForkPostAltair,
  isForkPostBellatrix,
  isForkPostDeneb,
  isForkPostElectra,
} from "@lodestar/params";
import {Epoch, SSZTypesFor, Slot, Version, sszTypesFor} from "@lodestar/types";
import {ChainConfig} from "../chainConfig/index.js";
import {ForkConfig, ForkInfo} from "./types.js";

export * from "./types.js";

export function createForkConfig(config: ChainConfig): ForkConfig {
  const phase0: ForkInfo = {
    name: ForkName.phase0,
    seq: ForkSeq.phase0,
    epoch: GENESIS_EPOCH,
    version: config.GENESIS_FORK_VERSION,
    // Will never be used
    prevVersion: config.GENESIS_FORK_VERSION,
    prevForkName: ForkName.phase0,
  };
  const altair: ForkInfo = {
    name: ForkName.altair,
    seq: ForkSeq.altair,
    epoch: config.ALTAIR_FORK_EPOCH,
    version: config.ALTAIR_FORK_VERSION,
    prevVersion: config.GENESIS_FORK_VERSION,
    prevForkName: ForkName.phase0,
  };
  const bellatrix: ForkInfo = {
    name: ForkName.bellatrix,
    seq: ForkSeq.bellatrix,
    epoch: config.BELLATRIX_FORK_EPOCH,
    version: config.BELLATRIX_FORK_VERSION,
    prevVersion: config.ALTAIR_FORK_VERSION,
    prevForkName: ForkName.altair,
  };
  const capella: ForkInfo = {
    name: ForkName.capella,
    seq: ForkSeq.capella,
    epoch: config.CAPELLA_FORK_EPOCH,
    version: config.CAPELLA_FORK_VERSION,
    prevVersion: config.BELLATRIX_FORK_VERSION,
    prevForkName: ForkName.bellatrix,
  };
  const deneb: ForkInfo = {
    name: ForkName.deneb,
    seq: ForkSeq.deneb,
    epoch: config.DENEB_FORK_EPOCH,
    version: config.DENEB_FORK_VERSION,
    prevVersion: config.CAPELLA_FORK_VERSION,
    prevForkName: ForkName.capella,
  };
  const electra: ForkInfo = {
    name: ForkName.electra,
    seq: ForkSeq.electra,
    epoch: config.ELECTRA_FORK_EPOCH,
    version: config.ELECTRA_FORK_VERSION,
    prevVersion: config.DENEB_FORK_VERSION,
    prevForkName: ForkName.deneb,
  };
  const fulu: ForkInfo = {
    name: ForkName.fulu,
    seq: ForkSeq.fulu,
    epoch: config.FULU_FORK_EPOCH,
    version: config.FULU_FORK_VERSION,
    prevVersion: config.ELECTRA_FORK_VERSION,
    prevForkName: ForkName.electra,
  };

  /** Forks in order order of occurence, `phase0` first */
  // Note: Downstream code relies on proper ordering.
  const forks = {phase0, altair, bellatrix, capella, deneb, electra, fulu};

  // Prevents allocating an array on every getForkInfo() call
  const forksAscendingEpochOrder = Object.values(forks);
  const forksDescendingEpochOrder = Object.values(forks).reverse();

  return {
    forks,
    forksAscendingEpochOrder,
    forksDescendingEpochOrder,

    // Fork convenience methods
    getForkInfo(slot: Slot): ForkInfo {
      const epoch = Math.floor(Math.max(slot, 0) / SLOTS_PER_EPOCH);
      return this.getForkInfoAtEpoch(epoch);
    },
    getForkInfoAtEpoch(epoch: Epoch): ForkInfo {
      // NOTE: forks must be sorted by descending epoch, latest fork first
      for (const fork of forksDescendingEpochOrder) {
        if (epoch >= fork.epoch) return fork;
      }
      return phase0;
    },
    getForkName(slot: Slot): ForkName {
      return this.getForkInfo(slot).name;
    },
    getForkSeq(slot: Slot): ForkSeq {
      return this.getForkInfo(slot).seq;
    },
    getForkSeqAtEpoch(epoch: Epoch): ForkSeq {
      return this.getForkInfoAtEpoch(epoch).seq;
    },
    getForkVersion(slot: Slot): Version {
      return this.getForkInfo(slot).version;
    },
    getForkTypes<F extends ForkName = ForkAll>(slot: Slot): SSZTypesFor<F> {
      return sszTypesFor(this.getForkName(slot)) as SSZTypesFor<F>;
    },
    getPostBellatrixForkTypes(slot: Slot): SSZTypesFor<ForkPostBellatrix> {
      const forkName = this.getForkName(slot);
      if (!isForkPostBellatrix(forkName)) {
        throw Error(`Invalid slot=${slot} fork=${forkName} for post-bellatrix fork types`);
      }
      return sszTypesFor(forkName);
    },
    getPostAltairForkTypes(slot: Slot): SSZTypesFor<ForkPostAltair> {
      const forkName = this.getForkName(slot);
      if (!isForkPostAltair(forkName)) {
        throw Error(`Invalid slot=${slot} fork=${forkName} for post-altair fork types`);
      }
      return sszTypesFor(forkName);
    },
    getPostDenebForkTypes(slot: Slot): SSZTypesFor<ForkPostDeneb> {
      const forkName = this.getForkName(slot);
      if (!isForkPostDeneb(forkName)) {
        throw Error(`Invalid slot=${slot} fork=${forkName} for post-deneb fork types`);
      }
      return sszTypesFor(forkName);
    },
    getMaxBlobsPerBlock(epoch: Epoch): number {
      const fork = this.getForkInfoAtEpoch(epoch).name;

      switch (fork) {
        case ForkName.electra:
          return config.MAX_BLOBS_PER_BLOCK_ELECTRA;
        case ForkName.deneb:
          return config.MAX_BLOBS_PER_BLOCK;
      }

      // Sort by epoch in descending order to find the latest applicable value
      const blobSchedule = [...config.BLOB_SCHEDULE].sort((a, b) => {
        if (a.EPOCH !== b.EPOCH) {
          return b.EPOCH - a.EPOCH;
        }
        return b.MAX_BLOBS_PER_BLOCK - a.MAX_BLOBS_PER_BLOCK;
      });

      for (const entry of blobSchedule) {
        if (epoch >= entry.EPOCH) {
          return entry.MAX_BLOBS_PER_BLOCK;
        }
      }

      return config.MAX_BLOBS_PER_BLOCK_ELECTRA;
    },
    getMaxRequestBlobSidecars(fork: ForkName): number {
      return isForkPostElectra(fork) ? config.MAX_REQUEST_BLOB_SIDECARS_ELECTRA : config.MAX_REQUEST_BLOB_SIDECARS;
    },
  };
}
