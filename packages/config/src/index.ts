import {GENESIS_EPOCH, IBeaconParams} from "@chainsafe/lodestar-params";
import {createIBeaconSSZTypes, Slot, IAllForksSSZTypes, Version} from "@chainsafe/lodestar-types";
import {IBeaconConfig, ForkName} from "./interface";

export * from "./interface";

export function createIBeaconConfig(params: IBeaconParams): IBeaconConfig {
  const types = createIBeaconSSZTypes(params);

  const phase0 = {name: ForkName.phase0, epoch: GENESIS_EPOCH, version: params.GENESIS_FORK_VERSION};
  const altair = {name: ForkName.altair, epoch: params.ALTAIR_FORK_EPOCH, version: params.ALTAIR_FORK_VERSION};

  return {
    params,
    types,

    forks: {altair, phase0},

    // Fork convenience methods
    getForkInfo(slot: Slot) {
      const epoch = Math.floor(slot / this.params.SLOTS_PER_EPOCH);
      // NOTE: forks must be sorted by descending epoch, latest fork first
      for (const fork of [altair, phase0]) {
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
    getTypes(slot: Slot): IAllForksSSZTypes {
      return types[this.getForkName(slot)] as IAllForksSSZTypes;
    },
  };
}
