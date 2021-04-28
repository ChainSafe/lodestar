import {GENESIS_EPOCH, IBeaconParams} from "@chainsafe/lodestar-params";
import {createIBeaconSSZTypes, Slot, IAllForksSSZTypes, Version, Epoch} from "@chainsafe/lodestar-types";

import {IBeaconConfig, IForkInfo, ForkName} from "./interface";

export * from "./interface";

export function createIBeaconConfig(params: IBeaconParams): IBeaconConfig {
  const types = createIBeaconSSZTypes(params);
  return {
    params,
    types,
    getForkInfoRecord(): Record<ForkName, IForkInfo> {
      return {
        phase0: {
          name: ForkName.phase0,
          epoch: GENESIS_EPOCH,
          version: params.GENESIS_FORK_VERSION,
        },
        altair: {
          name: ForkName.altair,
          epoch: params.ALTAIR_FORK_EPOCH,
          version: params.ALTAIR_FORK_VERSION,
        },
      };
    },
    getForkName(slot: Slot): ForkName {
      const epoch = computeEpochAtSlot(this, slot);
      if (epoch < params.ALTAIR_FORK_EPOCH) {
        return ForkName.phase0;
      } else {
        return ForkName.altair;
      }
    },
    getForkVersion(slot: Slot): Version {
      const epoch = computeEpochAtSlot(this, slot);
      if (epoch < params.ALTAIR_FORK_EPOCH) {
        return params.GENESIS_FORK_VERSION;
      } else {
        return params.ALTAIR_FORK_VERSION;
      }
    },
    getTypes(slot: Slot): IAllForksSSZTypes {
      const epoch = computeEpochAtSlot(this, slot);
      return types[this.getForkName(epoch)] as IAllForksSSZTypes;
    },
  };
}

function computeEpochAtSlot(config: IBeaconConfig, slot: Slot): Epoch {
  return Math.floor(slot / config.params.SLOTS_PER_EPOCH);
}
