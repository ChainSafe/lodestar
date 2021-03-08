import {GENESIS_SLOT, IBeaconParams} from "@chainsafe/lodestar-params";
import {
  createIBeaconSSZTypes,
  ILightclientSSZTypes,
  IPhase0SSZTypes,
  IPhase1SSZTypes,
  Slot,
  Version,
} from "@chainsafe/lodestar-types";

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
        lightclient: {
          name: "lightclient",
          slot: params.LIGHTCLIENT_PATCH_FORK_SLOT,
          version: params.LIGHTCLIENT_PATCH_FORK_VERSION,
        },
        phase1: {
          name: "phase1",
          slot: params.PHASE_1_FORK_SLOT,
          version: params.PHASE_1_FORK_VERSION,
        },
      };
    },
    getForkName(slot: Slot): IForkName {
      if (slot < params.LIGHTCLIENT_PATCH_FORK_SLOT) {
        return "phase0";
      } else if (slot < params.PHASE_1_FORK_SLOT) {
        return "lightclient";
      } else {
        return "phase1";
      }
    },
    getForkVersion(slot: Slot): Version {
      if (slot < params.LIGHTCLIENT_PATCH_FORK_SLOT) {
        return params.GENESIS_FORK_VERSION;
      } else if (slot < params.PHASE_1_FORK_SLOT) {
        return params.LIGHTCLIENT_PATCH_FORK_VERSION;
      } else {
        return params.PHASE_1_FORK_VERSION;
      }
    },
    getTypes(slot: Slot): IPhase0SSZTypes | ILightclientSSZTypes | IPhase1SSZTypes {
      return types[this.getForkName(slot)];
    },
  };
}
