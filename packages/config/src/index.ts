import {GENESIS_SLOT, IBeaconParams} from "@chainsafe/lodestar-params";
import {createIBeaconSSZTypes, IAllForksSSZTypes, Slot, Version} from "@chainsafe/lodestar-types";

import {IBeaconConfig, IForkInfo, IForkName} from "./interface";

export * from "./interface";

export function createIBeaconConfig(params: IBeaconParams): IBeaconConfig {
  const types = createIBeaconSSZTypes(params);
  return {
    params,
    types,
    getForkInfoRecord(): Record<IForkName, IForkInfo> {
      return {
        phase0: {
          name: "phase0",
          slot: GENESIS_SLOT,
          version: params.GENESIS_FORK_VERSION,
        },
        altair: {
          name: "altair",
          slot: params.ALTAIR_FORK_SLOT,
          version: params.ALTAIR_FORK_VERSION,
        },
      };
    },
    getForkName(slot: Slot): IForkName {
      if (slot < params.ALTAIR_FORK_SLOT) {
        return "phase0";
      } else {
        return "altair";
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
