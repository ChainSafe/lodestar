import {routes} from "@chainsafe/lodestar-api";
import {ChainConfig} from "@chainsafe/lodestar-config";
import * as params from "@chainsafe/lodestar-params";
import {ApiModules} from "../types";

export function getConfigApi({config}: Pick<ApiModules, "config">): routes.config.Api {
  const specWithExtraKeys = {...params, ...config};
  const spec = {} as routes.config.ISpec;
  ([
    ...Object.keys(ChainConfig.fields),
    ...Object.keys(params.BeaconPreset.fields),
  ] as (keyof routes.config.ISpec)[]).forEach((fieldName) => {
    ((spec as unknown) as Record<string, unknown>)[fieldName] = specWithExtraKeys[fieldName];
  });
  return {
    async getForkSchedule() {
      const forkInfos = Object.values(config.forks);
      const forks = forkInfos.map((fi, ix) => ({
        previousVersion: ix === 0 ? fi.version : forkInfos[ix - 1].version,
        currentVersion: fi.version,
        epoch: fi.epoch,
      }));
      return {data: forks};
    },

    async getDepositContract() {
      return {
        data: {
          chainId: config.DEPOSIT_CHAIN_ID,
          address: config.DEPOSIT_CONTRACT_ADDRESS,
        },
      };
    },

    async getSpec() {
      return {
        data: spec,
      };
    },
  };
}
