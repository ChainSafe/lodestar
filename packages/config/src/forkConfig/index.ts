import {
  ForkAll,
  ForkBlobs,
  ForkExecution,
  ForkLightClient,
  ForkName,
  ForkSeq,
  GENESIS_EPOCH,
  SLOTS_PER_EPOCH,
  isForkBlobs,
  isForkExecution,
  isForkLightClient,
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

  /** Forks in order order of occurence, `phase0` first */
  // Note: Downstream code relies on proper ordering.
  const forks = {phase0, altair, bellatrix, capella, deneb, electra};

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
    getExecutionForkTypes(slot: Slot): SSZTypesFor<ForkExecution> {
      const forkName = this.getForkName(slot);
      if (!isForkExecution(forkName)) {
        throw Error(`Invalid slot=${slot} fork=${forkName} for execution fork types`);
      }
      return sszTypesFor(forkName);
    },
    getLightClientForkTypes(slot: Slot): SSZTypesFor<ForkLightClient> {
      const forkName = this.getForkName(slot);
      if (!isForkLightClient(forkName)) {
        throw Error(`Invalid slot=${slot} fork=${forkName} for lightclient fork types`);
      }
      return sszTypesFor(forkName);
    },
    getBlobsForkTypes(slot: Slot): SSZTypesFor<ForkBlobs> {
      const forkName = this.getForkName(slot);
      if (!isForkBlobs(forkName)) {
        throw Error(`Invalid slot=${slot} fork=${forkName} for blobs fork types`);
      }
      return sszTypesFor(forkName);
    },
  };
}
