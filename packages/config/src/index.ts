import {GENESIS_SLOT, IBeaconParams} from "@chainsafe/lodestar-params";
import {createIBeaconSSZTypes, IAllForksSSZTypes, Slot, Version} from "@chainsafe/lodestar-types";

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
          slot: GENESIS_SLOT,
          version: params.GENESIS_FORK_VERSION,
        },
        altair: {
          name: ForkName.altair,
          slot: params.ALTAIR_FORK_SLOT,
          version: params.ALTAIR_FORK_VERSION,
        },
      };
    },
    getForkName(slot: Slot): ForkName {
      if (slot < params.ALTAIR_FORK_SLOT) {
        return ForkName.phase0;
      } else {
        return ForkName.altair;
      }
    },
    getForkVersion(slot: Slot): Version {
      if (slot < params.ALTAIR_FORK_SLOT) {
        return params.GENESIS_FORK_VERSION;
      } else {
        return params.ALTAIR_FORK_VERSION;
      }
    },
    getTypes(slot: Slot): IAllForksSSZTypes {
      return types[this.getForkName(slot)] as IAllForksSSZTypes;
    },
  };
}
