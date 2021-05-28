import {routes} from "@chainsafe/lodestar-api";
import * as params from "@chainsafe/lodestar-params";
import {ApiModules} from "../types";

export function getConfigApi({config}: Pick<ApiModules, "config">): routes.config.Api {
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
        data: {
          ...params,
          ...config,
        },
      };
    },
  };
}
