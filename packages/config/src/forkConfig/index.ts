import {GENESIS_EPOCH, ForkName, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {Slot, allForks, Version, ssz} from "@chainsafe/lodestar-types";
import {IChainConfig} from "../chainConfig/index.js";
import {IForkConfig, IForkInfo} from "./types.js";

export * from "./types.js";

export function createIForkConfig(config: IChainConfig): IForkConfig {
  const phase0 = {name: ForkName.phase0, epoch: GENESIS_EPOCH, version: config.GENESIS_FORK_VERSION};
  const altair = {name: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH, version: config.ALTAIR_FORK_VERSION};
  const bellatrix = {
    name: ForkName.bellatrix,
    epoch: config.BELLATRIX_FORK_EPOCH,
    version: config.BELLATRIX_FORK_VERSION,
  };

  /** Forks in order order of occurence, `phase0` first */
  // Note: Downstream code relies on proper ordering.
  const forks = {phase0, altair, bellatrix};

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
    getForkVersion(slot: Slot): Version {
      return this.getForkInfo(slot).version;
    },
    getForkTypes(slot: Slot): allForks.AllForksSSZTypes {
      return ssz.allForks[this.getForkName(slot)] as allForks.AllForksSSZTypes;
    },
  };
}
