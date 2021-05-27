import {routes} from "@chainsafe/lodestar-api";
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
          chainId: config.params.DEPOSIT_CHAIN_ID,
          address: config.params.DEPOSIT_CONTRACT_ADDRESS,
        },
      };
    },

    async getSpec() {
      return {data: config.params};
    },
  };
}
