import {routes, ServerApi} from "@lodestar/api";
import {Slot} from "@lodestar/types";
import {ApiModules} from "../types.js";

export function getBuilderApi({chain, config}: Pick<ApiModules, "chain" | "config">): ServerApi<routes.builder.Api> {
  return {
    async getExpectedWithdrawals(stateId: routes.beacon.StateId, proposalSlot?: Slot | undefined) {
      // eslint-disable-next-line no-console
      console.log(chain, config, stateId, proposalSlot);
      return {
        executionOptimistic: false,
        data: [
          {
            index: 1,
            validatorIndex: 1,
            address: "0xAbcF8e0d4e9587369b2301D0790347320302cc09",
            amount: 1,
          },
        ],
      };
    },
  };
}
