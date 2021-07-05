import {routes} from "@chainsafe/lodestar-api";
import {ISpec} from "@chainsafe/lodestar-api/lib/routes/config";
import {ChainConfig} from "@chainsafe/lodestar-config";
import * as params from "@chainsafe/lodestar-params";
import {ApiModules} from "../types";

export function getConfigApi({config}: Pick<ApiModules, "config">): routes.config.Api {
  const specWithExtraKeys = {...params, ...config};
  const spec = {} as ISpec;
  ([...Object.keys(ChainConfig.fields), ...Object.keys(params.BeaconPreset.fields)] as (keyof ISpec)[]).forEach(
    (fieldName) => {
      ((spec as unknown) as Record<string, unknown>)[fieldName] = specWithExtraKeys[fieldName];
    }
  );
  return {
    async getForkSchedule() {
      // @TODO: implement the actual fork schedule data get from config params once marin's altair PRs have been merged
      return {data: []};
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
