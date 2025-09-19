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
} from "@lodestar/params";
import {Epoch, SSZTypesFor, Slot, Version, sszTypesFor} from "@lodestar/types";
import {ChainConfig} from "../chainConfig/index.js";
import {BlobParameters, ForkBoundary, ForkConfig, ForkInfo} from "./types.js";

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
  const gloas: ForkInfo = {
    name: ForkName.gloas,
    seq: ForkSeq.gloas,
    epoch: config.GLOAS_FORK_EPOCH,
    version: config.GLOAS_FORK_VERSION,
    prevVersion: config.FULU_FORK_VERSION,
    prevForkName: ForkName.fulu,
  };

  /** Forks in order order of occurence, `phase0` first */
  // Note: Downstream code relies on proper ordering.
  const forks = {phase0, altair, bellatrix, capella, deneb, electra, fulu, gloas};

  // Prevents allocating an array on every getForkInfo() call
  const forksAscendingEpochOrder = Object.values(forks);
  const forksDescendingEpochOrder = Object.values(forks).reverse();

  const blobScheduleDescendingEpochOrder = [...config.BLOB_SCHEDULE].sort((a, b) => b.EPOCH - a.EPOCH);

  const forkBoundariesAscendingEpochOrder: ForkBoundary[] = [
    // Normal hard-forks (phase0, altair, etc.)
    ...forksAscendingEpochOrder.map((fork) => ({
      fork: fork.name,
      epoch: fork.epoch,
    })),
    // Blob Parameter Only (BPO) forks
    // Note: Must be appended after normal hard-forks to have precedence if scheduled at the same epoch
    ...config.BLOB_SCHEDULE.map((entry) => ({
      fork: forksDescendingEpochOrder.find((f) => entry.EPOCH >= f.epoch)?.name ?? phase0.name,
      epoch: entry.EPOCH,
    })),
  ]
    // Remove unscheduled fork boundaries
    .filter(({epoch}) => epoch !== Infinity)
    // Sort by epoch in ascending order
    .sort((a, b) => a.epoch - b.epoch);

  const forkBoundariesDescendingEpochOrder = [...forkBoundariesAscendingEpochOrder].reverse();

  return {
    forks,
    forksAscendingEpochOrder,
    forksDescendingEpochOrder,
    forkBoundariesAscendingEpochOrder,
    forkBoundariesDescendingEpochOrder,

    // Fork convenience methods
    getForkInfo(slot: Slot): ForkInfo {
      const epoch = Math.floor(Math.max(slot, 0) / SLOTS_PER_EPOCH);
      return this.getForkInfoAtEpoch(epoch);
    },
    getForkInfoAtEpoch(epoch: Epoch): ForkInfo {
      return forks[this.getForkBoundaryAtEpoch(epoch).fork];
    },
    getForkBoundaryAtEpoch(epoch: Epoch): ForkBoundary {
      if (epoch < 0) epoch = 0;
      // NOTE: fork boundaries must be sorted by descending epoch, latest first
      for (const boundary of forkBoundariesDescendingEpochOrder) {
        if (epoch >= boundary.epoch) return boundary;
      }
      throw Error("Unreachable as phase0 is scheduled at epoch 0");
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

      return this.getBlobParameters(epoch).maxBlobsPerBlock;
    },
    getBlobParameters(epoch: Epoch): BlobParameters {
      if (epoch < config.FULU_FORK_EPOCH) {
        throw Error(`getBlobParameters is not available pre-fulu epoch=${epoch}`);
      }

      // Find the latest applicable value from blob schedule
      for (const entry of blobScheduleDescendingEpochOrder) {
        if (epoch >= entry.EPOCH) {
          return {epoch: entry.EPOCH, maxBlobsPerBlock: entry.MAX_BLOBS_PER_BLOCK};
        }
      }

      return {epoch: config.ELECTRA_FORK_EPOCH, maxBlobsPerBlock: config.MAX_BLOBS_PER_BLOCK_ELECTRA};
    },
  };
}
