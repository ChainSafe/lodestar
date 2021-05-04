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
    getForkInfos(): IForkInfo[] {
      return Object.values(this.getForkInfoRecord());
    },
    getForkInfo(slot: Slot): IForkInfo {
      const forkSchedule = this.getForkInfos();
      if (!forkSchedule.length) {
        throw new Error("No available fork");
      }
      // if (forkSchedule.length === 1) return forkSchedule[0];

      // initialize to the first fork
      let currentFork = forkSchedule[0];
      // start from 1
      for (let i = 1; i < forkSchedule.length; i++) {
        const fork = forkSchedule[i];
        if (slot >= fork.slot) {
          currentFork = fork;
        } else {
          break;
        }
      }
      return currentFork;
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
