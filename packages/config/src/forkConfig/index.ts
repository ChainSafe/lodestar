import {GENESIS_EPOCH, ForkName, SLOTS_PER_EPOCH, ForkSeq, AllFork} from "@lodestar/params";
import {ForkGroup} from "@lodestar/params";
import {Slot, allForks, Version, ssz} from "@lodestar/types";
import {IChainConfig} from "../chainConfig/index.js";
import {IForkConfig, IForkInfo} from "./types.js";

export * from "./types.js";

export function createIForkConfig(config: IChainConfig): IForkConfig {
  const phase0: IForkInfo = {
    name: ForkName.phase0,
    seq: ForkSeq.phase0,
    epoch: GENESIS_EPOCH,
    version: config.GENESIS_FORK_VERSION,
    // Will never be used
    prevVersion: config.GENESIS_FORK_VERSION,
    prevForkName: ForkName.phase0,
  };
  const altair: IForkInfo = {
    name: ForkName.altair,
    seq: ForkSeq.altair,
    epoch: config.ALTAIR_FORK_EPOCH,
    version: config.ALTAIR_FORK_VERSION,
    prevVersion: config.GENESIS_FORK_VERSION,
    prevForkName: ForkName.phase0,
  };
  const bellatrix: IForkInfo = {
    name: ForkName.bellatrix,
    seq: ForkSeq.bellatrix,
    epoch: config.BELLATRIX_FORK_EPOCH,
    version: config.BELLATRIX_FORK_VERSION,
    prevVersion: config.ALTAIR_FORK_VERSION,
    prevForkName: ForkName.altair,
  };
  const capella: IForkInfo = {
    name: ForkName.capella,
    seq: ForkSeq.capella,
    epoch: config.CAPELLA_FORK_EPOCH,
    version: config.CAPELLA_FORK_VERSION,
    prevVersion: config.BELLATRIX_FORK_VERSION,
    prevForkName: ForkName.bellatrix,
  };

  /** Forks in order order of occurence, `phase0` first */
  // Note: Downstream code relies on proper ordering.
  const forks = {phase0, altair, bellatrix, capella};

  // Prevents allocating an array on every getForkInfo() call
  const forksAscendingEpochOrder = Object.values(forks);
  const forksDescendingEpochOrder = Object.values(forks).reverse();

  return {
    forks,
    forksAscendingEpochOrder,
    forksDescendingEpochOrder,

    // Fork convenience methods
    getForkInfo(slot: Slot): IForkInfo {
      const epoch = Math.floor(slot / SLOTS_PER_EPOCH);
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
    getForkVersion(slot: Slot): Version {
      return this.getForkInfo(slot).version;
    },
    getForkTypes<F extends ForkName = AllFork>(slot: Slot): allForks.SSZTypes<F> {
      return (ssz.allForks[this.getForkName(slot)] as unknown) as allForks.SSZTypes<F>;
    },
    getForkTypesForGroup<F extends ForkGroup>(slot: Slot, forkGroup: F): allForks.SSZTypes<F[number]> {
      const forkName = this.getForkName(slot) as F[number];
      if (!((forkGroup as unknown) as ForkName[]).includes(forkName)) {
        throw Error(`Invalid slot=${slot} fork=${forkName} for blinded fork types`);
      }
      return (ssz.allForks[forkName] as unknown) as allForks.SSZTypes<F[number]>;
    },
  };
}
