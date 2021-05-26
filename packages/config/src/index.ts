import {GENESIS_EPOCH, IBeaconParams} from "@chainsafe/lodestar-params";
import {createIBeaconSSZTypes, Slot, AllForksSSZTypes, Version} from "@chainsafe/lodestar-types";
import {IBeaconConfig, ForkName} from "./interface";
import {getForkTypesRecord} from "./forkTypes";

export * from "./interface";

export function createIBeaconConfig(params: IBeaconParams): IBeaconConfig {
  const types = createIBeaconSSZTypes(params);
  const forkTypes = getForkTypesRecord(types);

  const phase0 = {name: ForkName.phase0, epoch: GENESIS_EPOCH, version: params.GENESIS_FORK_VERSION};
  const altair = {name: ForkName.altair, epoch: params.ALTAIR_FORK_EPOCH, version: params.ALTAIR_FORK_VERSION};

  /** Forks in order order of occurence, `phase0` first */
  // Note: Downstream code relies on proper ordering.
  const forks = {phase0, altair};
  // Prevents allocating an array on every getForkInfo() call
  const forksDescendingEpochOrder = Object.values(forks).reverse();

  return {
    params,
    types,
    forks,

    // Fork convenience methods
    getForkInfo(slot: Slot) {
      const epoch = Math.floor(slot / this.params.SLOTS_PER_EPOCH);
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
    getForkTypes(slot: Slot): AllForksSSZTypes {
      return forkTypes[this.getForkName(slot)] as AllForksSSZTypes;
    },
  };
}
